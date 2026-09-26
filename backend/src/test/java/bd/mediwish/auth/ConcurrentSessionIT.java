package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.Generation;
import bd.mediwish.auth.AuthApi.Session;
import bd.mediwish.auth.AuthApi.User;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.net.http.HttpResponse;
import java.sql.SQLException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static bd.mediwish.auth.AuthApi.assertRefreshCookieCleared;
import static bd.mediwish.auth.AuthApi.race;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static org.assertj.core.api.Assertions.assertThat;

/** Racing refresh and logout requests on one session, serialized only by PostgreSQL row locks. */
@Tag("integration")
@Tag("security")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class ConcurrentSessionIT {
    private final AuthApi api;

    ConcurrentSessionIT(AuthApi api) {
        this.api = api;
    }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    /**
     * A separate transaction holds the refresh-token row, so both requests provably wait on its lock before either
     * can read it; once it is released exactly one rotates and the other sees a consumed cookie, a replay.
     */
    @Test
    void twoRefreshesOfOneCookieWaitOnItsRowLockAndOnlyOneRotates() throws Exception {
        User user = api.registered();
        Session initial = api.signIn(user);
        api.csrf();

        List<HttpResponse<String>> responses;
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var holder = api.database().connect()) {
            holder.setAutoCommit(false);
            try (var lock = holder.prepareStatement("SELECT t.id FROM user_session_refresh_tokens t "
                    + "JOIN user_sessions s ON s.id = t.session_id WHERE s.id = ? FOR UPDATE OF t")) {
                lock.setObject(1, api.sessionId(user));
                lock.executeQuery().close();
            }
            List<Future<HttpResponse<String>>> refreshes = List.of(
                    executor.submit(() -> api.refresh(initial.refreshToken())),
                    executor.submit(() -> api.refresh(initial.refreshToken())));
            awaitBackendsWaitingOnTheRefreshTokenLock(2);
            holder.commit();
            responses = List.of(refreshes.get(0).get(20, TimeUnit.SECONDS), refreshes.get(1).get(20, TimeUnit.SECONDS));
        }

        assertThat(responses).extracting(HttpResponse::statusCode).containsExactlyInAnyOrder(200, 401);
        HttpResponse<String> replay = responses.stream().filter(response -> response.statusCode() == 401)
                .findFirst().orElseThrow();
        assertError(replay, 401, "AUTHENTICATION_REQUIRED");
        assertRefreshCookieCleared(replay);
        Session winner = api.session(responses.stream().filter(response -> response.statusCode() == 200)
                .findFirst().orElseThrow());
        assertThat(api.generations(user)).containsExactly(new Generation(0, true), new Generation(1, false));
        assertThat(api.revoked(user, RevocationReason.REFRESH_REPLAY)).isOne();
        assertError(api.profile(winner.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(winner.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    /** Whichever wins, the family ends revoked by logout with no extra session and at most one new generation. */
    @Test
    void logoutRacingARefreshLeavesTheSessionRevoked() throws Exception {
        User user = api.registered();
        Session initial = api.signIn(user);

        var responses = race(() -> api.refresh(initial.refreshToken()), () -> api.logout(initial.refreshToken()));

        HttpResponse<String> refresh = responses.get(0);
        assertThat(responses.get(1).statusCode()).isEqualTo(204);
        assertRefreshCookieCleared(responses.get(1));
        assertThat(api.revoked(user, RevocationReason.LOGOUT)).isOne();
        assertThat(api.sessions(user)).isOne();
        assertError(api.profile(initial.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        if (refresh.statusCode() == 200) {
            Session rotated = api.session(refresh);
            assertThat(api.generations(user)).containsExactly(new Generation(0, true), new Generation(1, false));
            assertError(api.profile(rotated.accessToken()), 401, "AUTHENTICATION_REQUIRED");
            assertError(api.refresh(rotated.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        } else {
            assertError(refresh, 401, "AUTHENTICATION_REQUIRED");
            assertThat(api.generations(user)).containsExactly(new Generation(0, false));
        }
    }

    /** Logout revokes duplicated cookies in a fixed order, so opposite cookie orders cannot deadlock. */
    @Test
    void logoutsNamingTwoSessionsInOppositeOrdersBothSucceed() throws Exception {
        User user = api.registered();
        Session first = api.signIn(user);
        Session second = api.signIn(user);

        var responses = race(() -> api.logout(first.refreshToken(), second.refreshToken()),
                () -> api.logout(second.refreshToken(), first.refreshToken()));

        assertThat(responses).extracting(HttpResponse::statusCode).containsExactly(204, 204);
        assertThat(api.revoked(user, RevocationReason.LOGOUT)).isEqualTo(2);
        assertError(api.profile(first.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.profile(second.accessToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    /** Polls pg_locks until the given number of this role's backends wait, ungranted, on a refresh-token query. */
    private void awaitBackendsWaitingOnTheRefreshTokenLock(int expected) throws SQLException, InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
        long waiting;
        do {
            waiting = api.database().single("SELECT count(DISTINCT l.pid) FROM pg_locks l "
                    + "JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted "
                    + "AND a.datname = current_database() AND a.usename = current_user "
                    + "AND a.query LIKE '%user_session_refresh_tokens%'", Long.class);
            if (waiting == expected) return;
            Thread.sleep(10);
        } while (System.nanoTime() < deadline);
        throw new AssertionError("expected " + expected + " refreshes waiting on the row lock but saw " + waiting);
    }
}
