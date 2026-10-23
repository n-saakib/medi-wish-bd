package bd.mediwish.auth;

import bd.mediwish.user.*;
import org.junit.jupiter.api.*;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.*;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.*;

/** Real blocked transactions prove serialization and unique-constraint rollback, rather than lucky scheduling. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Tag("integration")
@Tag("recovery")
class ConcurrentProfileIT {
    private final AuthApi api = AuthApi.start();
    @AfterAll void close() throws Exception { api.close(); }

    @Test
    void differentEditsFromOneVersionSerializeToOneSaveAndOneStaleResponse() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        try (var gate = lock(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = workers.submit(() -> api.putProfile(token, AuthApi.profileEdit(0, "First Edit", user.email(), null)));
            var second = workers.submit(() -> api.putProfile(token, AuthApi.profileEdit(0, "Second Edit", user.email(), null)));
            awaitBlocked(gate, 2);
            gate.commit();
            var responses = java.util.List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            assertThat(responses).extracting(HttpResponse::statusCode).containsExactlyInAnyOrder(200, 409);
            assertError(responses.stream().filter(r -> r.statusCode() == 409).findFirst().orElseThrow(), 409, "STALE_UPDATE");
            assertThat(json(api.profileOf(token))).containsEntry("version", 1);
        }
    }

    @Test
    void identicalBlockedEditsBothSucceedAndBumpOnlyOnce() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        String body = AuthApi.profileEdit(0, "Same Edit", user.email(), null);
        try (var gate = lock(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = workers.submit(() -> api.putProfile(token, body));
            var second = workers.submit(() -> api.putProfile(token, body));
            awaitBlocked(gate, 2);
            gate.commit();
            assertThat(first.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            assertThat(second.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            assertThat(json(api.profileOf(token))).containsEntry("version", 1).containsEntry("fullName", "Same Edit");
        }
    }

    @Test
    void twoBlockedStagesReplaceThePendingRowWithoutChangingTheCurrentContact() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        String firstNumber = api.newUser().mobile(), secondNumber = api.newUser().mobile();
        try (var gate = lock(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = workers.submit(() -> api.stageMobile(token, firstNumber));
            var second = workers.submit(() -> api.stageMobile(token, secondNumber));
            awaitBlocked(gate, 2);
            gate.commit();
            assertThat(first.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(202);
            assertThat(second.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(202);
            assertThat(api.database().single("SELECT count(*) FROM user_mobile_changes WHERE user_id = ?",
                    Long.class, api.userId(user))).isOne();
            assertThat(json(api.profileOf(token))).containsEntry("mobile", user.mobile()).containsEntry("version", 0);
        }
    }

    @Test
    void anUncommittedEmailCollisionHitsTheDatabaseFallbackAndRollsBackTheWholeEdit() throws Exception {
        var first = api.registered();
        var other = api.registered();
        String token = api.signIn(first).accessToken();
        String email = "racing." + UUID.randomUUID() + "@example.test";
        try (var claimant = api.database().connect(); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            claimant.setAutoCommit(false);
            try (var statement = claimant.prepareStatement("UPDATE users SET email = ? WHERE id = ?")) {
                statement.setString(1, email); statement.setObject(2, api.userId(other)); statement.executeUpdate();
            }
            var save = workers.submit(() -> api.putProfile(token, api.profileEdit(first, 0, "Must Roll Back", email, null)));
            awaitBlocked(claimant, 1);
            claimant.commit();
            assertError(save.get(10, TimeUnit.SECONDS), 409, "DUPLICATE_USER");
            assertThat(json(api.profileOf(token))).containsEntry("fullName", null).containsEntry("email", first.email())
                    .containsEntry("version", 0);
        }
    }

    @Test
    void activationUniqueFailureKeepsThePendingChangeAndTheOriginalMobile() throws Exception {
        var user = api.registered();
        var other = api.registered();
        String token = api.signIn(user).accessToken();
        String mobile = api.newUser().mobile();
        assertThat(api.stageMobile(token, mobile).statusCode()).isEqualTo(202);
        UUID id = api.userId(user), pending = pendingId(id);
        try (var claimant = api.database().connect(); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            claimant.setAutoCommit(false);
            try (var statement = claimant.prepareStatement("UPDATE users SET mobile = ? WHERE id = ?")) {
                statement.setString(1, mobile); statement.setObject(2, api.userId(other)); statement.executeUpdate();
            }
            var activation = workers.submit(() -> api.app().bean(MobileChangeService.class).activate(id, pending));
            awaitBlocked(claimant, 1);
            claimant.commit();
            assertThatThrownBy(() -> activation.get(10, TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(UserService.DuplicateUserException.class);
            assertThat(json(api.profileOf(token))).containsEntry("mobile", user.mobile())
                    .containsEntry("mobileVerified", false).containsEntry("pendingMobile", mobile);
            assertThat(pendingId(id)).isEqualTo(pending);
        }
    }

    @Test
    void aReplacedChangeCannotActivateAndOnlyOneUserCanActivateASharedPendingNumber() throws Exception {
        var first = api.registered(); var second = api.registered();
        String firstToken = api.signIn(first).accessToken(), secondToken = api.signIn(second).accessToken();
        UUID firstId = api.userId(first), secondId = api.userId(second);
        api.stageMobile(firstToken, api.newUser().mobile());
        UUID obsolete = pendingId(firstId);
        String shared = api.newUser().mobile();
        api.stageMobile(firstToken, shared); api.stageMobile(secondToken, shared);
        var service = api.app().bean(MobileChangeService.class);
        assertThatThrownBy(() -> service.activate(firstId, obsolete)).isInstanceOf(MobileChangeNotPendingException.class);
        UUID firstPending = pendingId(firstId), secondPending = pendingId(secondId);
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var one = workers.submit(() -> activate(service, firstId, firstPending));
            var two = workers.submit(() -> activate(service, secondId, secondPending));
            assertThat(java.util.List.of(one.get(10, TimeUnit.SECONDS), two.get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("activated", "duplicate");
        }
        var profiles = java.util.List.of(json(api.profileOf(firstToken)), json(api.profileOf(secondToken)));
        assertThat(profiles.stream().filter(p -> shared.equals(p.get("mobile"))).count()).isOne();
        assertThat(profiles.stream().filter(p -> shared.equals(p.get("pendingMobile"))).count()).isOne();
    }

    @Test
    void aClosureCommittedWhileAnEditWaitsPreventsTheWrite() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        try (var gate = lock(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            try (var statement = gate.prepareStatement("UPDATE users SET account_state = 'CLOSURE_REQUESTED' WHERE id = ?")) {
                statement.setObject(1, api.userId(user)); statement.executeUpdate();
            }
            var save = workers.submit(() -> api.putProfile(token, AuthApi.profileEdit(0, "Blocked Edit", user.email(), null)));
            awaitBlocked(gate, 1);
            gate.commit();
            assertError(save.get(10, TimeUnit.SECONDS), 409, "ACCOUNT_CLOSING");
            assertThat(json(api.profileOf(token))).containsEntry("fullName", null).containsEntry("version", 0);
        }
    }

    @Test
    void aClosureWaitingForAProfileCommitAppliesAfterTheSavedEdit() throws Exception {
        var user = api.registered();
        UUID id = api.userId(user);
        String token = api.signIn(user).accessToken();
        long lockKey = UUID.randomUUID().getMostSignificantBits();
        // A deferred trigger pauses the real HTTP PUT at commit while it still owns the User row.
        try (var commitGate = holdProfileCommit(id, lockKey);
             var gate = api.database().connect(); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            gate.setAutoCommit(false);
            try (var statement = gate.prepareStatement("SELECT pg_advisory_xact_lock(?)")) {
                statement.setLong(1, lockKey);
                statement.execute();
            }
            long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
            var save = workers.submit(() -> api.putProfile(token,
                    AuthApi.profileEdit(0, "Saved Before Closure", user.email(), null)));
            awaitBlocked(gate, 1, deadline);
            var closure = workers.submit(() -> api.database().update(
                    "UPDATE users SET account_state = 'CLOSURE_REQUESTED' WHERE id = ?", id));
            awaitBlocked(gate, 2, deadline);
            gate.commit();
            var saved = save.get(10, TimeUnit.SECONDS);
            assertThat(saved.statusCode()).isEqualTo(200);
            assertThat(json(saved)).containsEntry("fullName", "Saved Before Closure")
                    .containsEntry("accountState", "ACTIVE").containsEntry("version", 1);
            assertThat(closure.get(10, TimeUnit.SECONDS)).isOne();
            assertThat(json(api.profileOf(token))).containsEntry("fullName", "Saved Before Closure")
                    .containsEntry("accountState", "CLOSURE_REQUESTED").containsEntry("version", 1);
        }
    }

    private AutoCloseable holdProfileCommit(UUID id, long lockKey) throws Exception {
        api.database().update("CREATE FUNCTION hold_profile_commit() RETURNS trigger LANGUAGE plpgsql AS $$ "
                + "BEGIN IF NEW.id = '" + id + "'::uuid AND NEW.account_state = 'ACTIVE' THEN "
                + "PERFORM pg_advisory_xact_lock(" + lockKey + "); END IF; RETURN NEW; END $$");
        api.database().update("CREATE CONSTRAINT TRIGGER hold_profile_commit AFTER UPDATE ON users "
                + "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hold_profile_commit()");
        return () -> {
            api.database().update("DROP TRIGGER hold_profile_commit ON users");
            api.database().update("DROP FUNCTION hold_profile_commit()");
        };
    }

    private static String activate(MobileChangeService service, UUID user, UUID change) {
        try { service.activate(user, change); return "activated"; }
        catch (UserService.DuplicateUserException expected) { return "duplicate"; }
    }

    private UUID pendingId(UUID id) throws Exception {
        return api.database().single("SELECT id FROM user_mobile_changes WHERE user_id = ?", UUID.class, id);
    }

    private Connection lock(UUID id) throws Exception {
        var connection = api.database().connect();
        connection.setAutoCommit(false);
        try (var statement = connection.prepareStatement("SELECT id FROM users WHERE id = ? FOR UPDATE")) {
            statement.setObject(1, id);
            try (var row = statement.executeQuery()) { assertThat(row.next()).isTrue(); }
        }
        return connection;
    }

    private void awaitBlocked(Connection gate, int count) throws Exception {
        awaitBlocked(gate, count, System.nanoTime() + Duration.ofSeconds(2).toNanos());
    }

    private void awaitBlocked(Connection gate, int count, long deadline) throws Exception {
        int gatePid;
        try (var statement = gate.createStatement(); var row = statement.executeQuery("SELECT pg_backend_pid()")) {
            assertThat(row.next()).isTrue();
            gatePid = row.getInt(1);
        }
        // The second row-lock waiter may wait on the first waiter rather than directly on the gate.
        String waitingChain = """
                WITH RECURSIVE blocked(pid) AS (
                    SELECT pid FROM pg_stat_activity
                    WHERE datname = current_database() AND usename = current_user
                      AND ? = ANY(pg_blocking_pids(pid))
                    UNION
                    SELECT activity.pid FROM pg_stat_activity activity JOIN blocked
                      ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
                    WHERE activity.datname = current_database() AND activity.usename = current_user
                )
                SELECT count(*) FROM blocked
                """;
        while (System.nanoTime() < deadline) {
            long blocked = api.database().single(waitingChain, Long.class, gatePid);
            if (blocked >= count) return;
            Thread.sleep(10);
        }
        fail("Expected " + count + " PostgreSQL transactions blocked by the gate connection");
    }
}
