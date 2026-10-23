package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

/** Deterministic PostgreSQL lock races prove recovery serialization and atomic address throttling. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
@Tag("integration")
@Tag("recovery")
@Tag("security")
class ConcurrentRecoveryIT {
    private final AuthApi api = AuthApi.start();

    private static void assertEmpty(HttpResponse<String> response, int status) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.body()).isEmpty();
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
    }
    @AfterAll void close() throws Exception { api.close(); }

    @BeforeEach void protectKey() { api.track(api.app().bean(AuthProperties.class).recovery().codeKey()); }

    @AfterEach void logsOmitSecrets(CapturedOutput output) throws Exception {
        api.drainMail();
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void onlyOneOfTwoBlockedConfirmationsConsumesTheCodeAndChangesThePassword() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        assertEmpty(api.requestReset(user.email()), 202);
        String code = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
        String beforeHash = passwordHash(user);
        String firstPassword = newPassword("race-a-");
        String secondPassword = newPassword("race-b-");
        List<HttpResponse<String>> responses;

        try (var gate = lockUser(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = workers.submit(() -> api.confirmReset(user.email(), code, firstPassword));
            var second = workers.submit(() -> api.confirmReset(user.email(), code, secondPassword));
            try {
                awaitBlocked(gate, 2);
            } finally {
                gate.commit();
            }
            responses = List.of(first.get(15, TimeUnit.SECONDS), second.get(15, TimeUnit.SECONDS));
        }

        assertThat(responses).extracting(HttpResponse::statusCode).containsExactlyInAnyOrder(204, 400);
        assertError(responses.stream().filter(response -> response.statusCode() == 400).findFirst().orElseThrow(),
                400, "CODE_INVALID");
        assertThat(api.accountCodes(user)).isEmpty();
        assertThat(passwordHash(user)).isNotEqualTo(beforeHash);
        assertThat(eventCount(user, "PASSWORD_RESET_COMPLETED")).isOne();
        if (responses.get(0).statusCode() == 204) {
            api.session(api.login(user.username(), firstPassword));
            assertError(api.login(user.username(), secondPassword), 401, "AUTHENTICATION_FAILED");
        } else {
            api.session(api.login(user.username(), secondPassword));
            assertError(api.login(user.username(), firstPassword), 401, "AUTHENTICATION_FAILED");
        }
    }

    @Test
    void aConfirmRacingAReplacementRequestUsesOnlyTheStateThatCommittedFirst() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        assertEmpty(api.requestReset(user.email()), 202);
        var previous = api.accountCodes(user).getFirst();
        String oldCode = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
        api.ageLimits(Duration.ofSeconds(61));
        api.capturedMail().clear();
        String newPassword = newPassword("race-confirm-");
        HttpResponse<String> confirmation;
        HttpResponse<String> request;

        try (var gate = lockUser(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var confirmFuture = workers.submit(() -> api.confirmReset(user.email(), oldCode, newPassword));
            var requestFuture = workers.submit(() -> api.requestReset(user.email()));
            try {
                awaitBlocked(gate, 2);
            } finally {
                gate.commit();
            }
            confirmation = confirmFuture.get(15, TimeUnit.SECONDS);
            request = requestFuture.get(15, TimeUnit.SECONDS);
        }

        assertEmpty(request, 202);
        assertThat(confirmation.statusCode()).isIn(204, 400);
        if (confirmation.statusCode() == 400) assertError(confirmation, 400, "CODE_INVALID");
        var replacementMail = api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email());
        var liveCodes = api.accountCodes(user);
        String replacementCode = AuthApi.codeFrom(replacementMail);
        assertThat(liveCodes).singleElement().satisfies(row -> {
            assertThat(row.id()).isNotEqualTo(previous.id());
            assertThat(row.sentTo()).isEqualTo(user.email());
        });
        if (confirmation.statusCode() == 400) assertThat(replacementCode).isNotEqualTo(oldCode);
        if (confirmation.statusCode() == 204) {
            api.session(api.login(user.username(), newPassword));
            assertError(api.login(user.username(), user.password()), 401, "AUTHENTICATION_FAILED");
            assertThat(eventCount(user, "PASSWORD_RESET_COMPLETED")).isOne();
        } else {
            api.session(api.login(user.username(), user.password()));
            assertError(api.login(user.username(), newPassword), 401, "AUTHENTICATION_FAILED");
            assertThat(api.accountCodes(user).getFirst().failedAttempts()).isEqualTo(1);
            assertThat(eventCount(user, "PASSWORD_RESET_COMPLETED")).isZero();
        }
    }

    @Test
    void twoBlockedRequestsLeaveOneReplacementCodeAndOneIssuance() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        assertEmpty(api.requestReset(user.email()), 202);
        var previous = api.accountCodes(user).getFirst();
        api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email());
        api.ageLimits(Duration.ofSeconds(61));
        api.capturedMail().clear();

        try (var gate = lockUser(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = workers.submit(() -> api.requestReset(user.email()));
            var second = workers.submit(() -> api.requestReset(user.email()));
            try {
                // The address-counter upsert serializes these transactions; the second waiter can depend on the
                // first, which is itself waiting for this User row.
                awaitBlocked(gate, 2);
            } finally {
                gate.commit();
            }
            assertEmpty(first.get(15, TimeUnit.SECONDS), 202);
            assertEmpty(second.get(15, TimeUnit.SECONDS), 202);
        }

        var replacement = api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email());
        assertThat(AuthApi.codeFrom(replacement)).matches("[0-9]{6}");
        assertThat(api.accountCodes(user)).singleElement().satisfies(row -> {
            assertThat(row.id()).isNotEqualTo(previous.id());
            assertThat(row.purpose()).isEqualTo(AccountCodePurpose.PASSWORD_RESET);
        });
        assertThat(eventCount(user, "PASSWORD_RESET_REQUESTED")).isEqualTo(2);
        assertThat(api.capturedMail().messages()).hasSize(1);
    }

    @Test
    void anEmailChangeAndResetConfirmationCannotBothCommitAgainstTheOldAddress() throws Exception {
        var user = api.registered();
        var changingSession = api.signIn(user);
        api.markEmailVerified(user);
        assertEmpty(api.requestReset(user.email()), 202);
        String code = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
        String replacementEmail = api.track("concurrent-change." + UUID.randomUUID() + "@example.test");
        String resetPassword = newPassword("race-email-");
        HttpResponse<String> change;
        HttpResponse<String> reset;

        try (var gate = lockUser(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var changeFuture = workers.submit(() -> api.putProfileWithPassword(changingSession.accessToken(), 0,
                    null, replacementEmail, null, user.password()));
            var resetFuture = workers.submit(() -> api.confirmReset(user.email(), code, resetPassword));
            try {
                awaitBlocked(gate, 2);
            } finally {
                gate.commit();
            }
            change = changeFuture.get(15, TimeUnit.SECONDS);
            reset = resetFuture.get(15, TimeUnit.SECONDS);
        }

        assertThat(change.statusCode()).isIn(200, 400, 401);
        assertThat(reset.statusCode()).isIn(204, 400);
        if (change.statusCode() == 200) {
            assertThat(json(change)).containsEntry("email", replacementEmail).containsEntry("emailVerified", false);
            assertError(reset, 400, "CODE_INVALID");
            api.session(api.login(user.username(), user.password()));
            assertError(api.login(user.username(), resetPassword), 401, "AUTHENTICATION_FAILED");
            assertThat(eventCount(user, "EMAIL_CHANGED")).isOne();
            assertThat(eventCount(user, "PASSWORD_RESET_COMPLETED")).isZero();
            assertThat(api.profile(changingSession.accessToken()).statusCode()).isEqualTo(200);
        } else {
            assertThat(change.statusCode()).isIn(400, 401);
            if (change.statusCode() == 400) assertError(change, 400, "CURRENT_PASSWORD_INVALID");
            else assertError(change, 401, "AUTHENTICATION_REQUIRED");
            assertEmpty(reset, 204);
            assertThat(storedEmail(user)).isEqualTo(user.email());
            assertError(api.login(user.username(), user.password()), 401, "AUTHENTICATION_FAILED");
            api.session(api.login(user.username(), resetPassword));
            assertThat(eventCount(user, "EMAIL_CHANGED")).isZero();
            assertThat(eventCount(user, "PASSWORD_RESET_COMPLETED")).isOne();
        }
        assertThat(api.accountCodes(user)).isEmpty();
    }

    @Test
    void refreshThatFinishesWhileEmailChangeWaitsIsRevokedByTheCommittedChange() throws Exception {
        var user = api.registered();
        var changingSession = api.signIn(user);
        var refreshingSession = api.signIn(user);
        String replacementEmail = api.track("refresh-race." + UUID.randomUUID() + "@example.test");
        HttpResponse<String> change;
        HttpResponse<String> refresh;

        try (var gate = lockUser(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var changeFuture = workers.submit(() -> api.putProfileWithPassword(changingSession.accessToken(), 0,
                    null, replacementEmail, null, user.password()));
            try {
                awaitBlocked(gate, 1);
                // Refresh does not lock the User row. Let it rotate S2 while the email change is definitely in flight.
                refresh = api.refresh(refreshingSession.refreshToken());
            } finally {
                gate.commit();
            }
            change = changeFuture.get(15, TimeUnit.SECONDS);
        }

        assertThat(change.statusCode()).isEqualTo(200);
        assertThat(json(change)).containsEntry("email", replacementEmail);
        var rotated = api.session(refresh);
        assertThat(api.profile(changingSession.accessToken()).statusCode()).isEqualTo(200);
        assertError(api.profile(refreshingSession.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.profile(rotated.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(refreshingSession.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(rotated.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        assertThat(api.revoked(user, RevocationReason.EMAIL_CHANGED)).isOne();
    }

    @Test
    void twoWrongAttemptsRacingAtFourVoidTheCodeAtTheLimitWithoutA6thAttempt() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        assertEmpty(api.requestReset(user.email()), 202);
        String code = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
        assertThat(api.database().update(
                "UPDATE account_codes SET failed_attempts = 4 WHERE user_id = ? AND purpose = ?",
                api.userId(user), AccountCodePurpose.PASSWORD_RESET.name())).isOne();
        String wrong = nextCode(code);
        String firstPassword = newPassword("wrong-a-");
        String secondPassword = newPassword("wrong-b-");
        List<HttpResponse<String>> responses;

        try (var gate = lockUser(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = workers.submit(() -> api.confirmReset(user.email(), wrong, firstPassword));
            var second = workers.submit(() -> api.confirmReset(user.email(), wrong, secondPassword));
            try {
                awaitBlocked(gate, 2);
            } finally {
                gate.commit();
            }
            responses = List.of(first.get(15, TimeUnit.SECONDS), second.get(15, TimeUnit.SECONDS));
        }

        responses.forEach(response -> assertError(response, 400, "CODE_INVALID"));
        assertThat(api.accountCodes(user)).isEmpty();
        assertThat(eventCount(user, "ACCOUNT_CODE_LOCKED")).isOne();
        assertThat(eventCount(user, "ACCOUNT_CODE_FAILED")).isZero();
    }

    @Test
    void twelveParallelAddressAttemptsRecordTwelveAndOnlyTheFirstTenAreAdmitted(CapturedOutput output)
            throws Exception {
        var properties = Map.<String, Object>of(
                "spring.datasource.hikari.maximum-pool-size", "20",
                "app.auth.recovery.issues-per-window", "20",
                "app.auth.recovery.issue-gap", "PT1S");
        try (var counted = AuthApi.start(properties, AdvancingClockConfiguration.class)) {
            counted.track(counted.app().bean(AuthProperties.class).recovery().codeKey());
            var user = counted.registered();
            counted.markEmailVerified(user);
            counted.app().bean(SteppingClock.class).restartAt(Instant.now());
            var responses = parallel(12, () -> counted.requestReset(user.email()));

            assertThat(responses).hasSize(12).allSatisfy(response -> assertEmpty(response, 202));
            counted.drainMail();
            String addressKey = counted.app().bean(AccountCodeHasher.class).addressKey(user.email());
            assertThat(counted.database().single("SELECT attempts FROM account_code_limits WHERE limit_key = ?",
                    Integer.class, addressKey)).isEqualTo(12);
            assertThat(counted.database().single("SELECT count(*) FROM security_audit_events "
                            + "WHERE subject_user_id = ? AND event_type = 'PASSWORD_RESET_REQUESTED'",
                    Long.class, counted.userId(user))).isEqualTo(10);
            assertThat(counted.capturedMail().messages()).hasSize(10)
                    .allSatisfy(message -> assertThat(message.kind()).isEqualTo(EmailKind.PASSWORD_RESET_CODE));
            assertThat(counted.accountCodes(user)).singleElement()
                    .satisfies(row -> assertThat(row.purpose()).isEqualTo(AccountCodePurpose.PASSWORD_RESET));
            for (var message : counted.capturedMail().messages()) {
                boolean logged = Pattern.compile("(?<![0-9])" + Pattern.quote(AuthApi.codeFrom(message))
                                + "(?![0-9])")
                        .matcher(output.getAll()).find();
                assertThat(logged).isFalse();
            }
            counted.assertLogsOmitSecrets(output);
        }
    }

    @Test
    void aWaitingOldAddressRequestRefreshesTheManagedUserAndLeavesItsExistingCodeAlone() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        assertEmpty(api.requestReset(user.email()), 202);
        var existingCode = api.accountCodes(user).getFirst();
        api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email());
        api.ageLimits(Duration.ofSeconds(61));
        api.capturedMail().clear();
        String replacementEmail = api.track("post-lock." + UUID.randomUUID() + "@example.test");
        HttpResponse<String> request;

        try (var gate = lockUser(api.userId(user)); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var requestFuture = workers.submit(() -> api.requestReset(user.email()));
            try {
                // This lock wait proves the old-email candidate was read before the changed address is committed.
                awaitBlocked(gate, 1);
                try (var update = gate.prepareStatement(
                        "UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?")) {
                    update.setString(1, replacementEmail);
                    update.setObject(2, api.userId(user));
                    assertThat(update.executeUpdate()).isOne();
                }
            } finally {
                gate.commit();
            }
            request = requestFuture.get(15, TimeUnit.SECONDS);
        }

        assertEmpty(request, 202);
        api.drainMail();
        assertThat(storedEmail(user)).isEqualTo(replacementEmail);
        assertThat(api.accountCodes(user)).containsExactly(existingCode);
        assertThat(eventCount(user, "PASSWORD_RESET_REQUESTED")).isOne();
        assertThat(api.capturedMail().messages()).isEmpty();
    }

    @Test
    void anotherRequestsPruneSkipsAnAgedIssueCounterWhileItsRowIsLocked() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        assertEmpty(api.requestReset(user.email()), 202);
        api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email());
        String lockedKey = "issue:" + api.userId(user);
        String unlockedKey = "issue:" + UUID.randomUUID();
        assertThat(api.database().update("UPDATE account_code_limits SET window_started_at = now() - interval '3 hours', "
                + "last_at = now() - interval '3 hours' WHERE limit_key = ?", lockedKey)).isOne();
        assertThat(api.database().update("INSERT INTO account_code_limits (limit_key, window_started_at, attempts, last_at) "
                + "VALUES (?, now() - interval '3 hours', 1, now() - interval '3 hours')", unlockedKey)).isOne();
        Instant agedWindow = api.database().single(
                "SELECT window_started_at FROM account_code_limits WHERE limit_key = ?", java.sql.Timestamp.class,
                lockedKey).toInstant();
        String otherAddress = api.track("prune-skip." + UUID.randomUUID() + "@example.test");

        try (var gate = lockLimit(lockedKey); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                // An issuer holding this counter (findByIdForUpdate) must not lose it to a concurrent prune.
                assertEmpty(workers.submit(() -> api.requestReset(otherAddress)).get(15, TimeUnit.SECONDS), 202);
                assertThat(limitCount(lockedKey)).isOne();
                assertThat(limitCount(unlockedKey)).isZero();
            } finally {
                gate.commit();
            }
        }

        assertThat(api.database().single("SELECT window_started_at FROM account_code_limits WHERE limit_key = ?",
                java.sql.Timestamp.class, lockedKey).toInstant()).isEqualTo(agedWindow);
    }

    private Connection lockLimit(String key) throws SQLException {
        Connection connection = api.database().connect();
        connection.setAutoCommit(false);
        try (var statement = connection.prepareStatement(
                "SELECT limit_key FROM account_code_limits WHERE limit_key = ? FOR UPDATE")) {
            statement.setString(1, key);
            try (var row = statement.executeQuery()) {
                if (!row.next()) throw new AssertionError("The issue-counter fixture is missing");
            }
        }
        return connection;
    }

    private long limitCount(String key) throws SQLException {
        return api.database().single("SELECT count(*) FROM account_code_limits WHERE limit_key = ?", Long.class, key);
    }

    private Connection lockUser(UUID userId) throws SQLException {
        Connection connection = api.database().connect();
        connection.setAutoCommit(false);
        try (var statement = connection.prepareStatement("SELECT id FROM users WHERE id = ? FOR UPDATE")) {
            statement.setObject(1, userId);
            try (var row = statement.executeQuery()) {
                if (!row.next()) throw new AssertionError("The recovery User fixture is missing");
            }
        }
        return connection;
    }

    /** Counts the blocked dependency chain, including a second request waiting behind the first request's lock. */
    private void awaitBlocked(Connection gate, int expected) throws Exception {
        int gatePid;
        try (var statement = gate.createStatement(); var row = statement.executeQuery("SELECT pg_backend_pid()")) {
            if (!row.next()) throw new AssertionError("Could not identify the PostgreSQL gate connection");
            gatePid = row.getInt(1);
        }
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
                SELECT count(DISTINCT blocked.pid) FROM blocked
                JOIN pg_locks waiting_lock ON waiting_lock.pid = blocked.pid AND NOT waiting_lock.granted
                """;
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        long blocked = 0;
        try (var observation = api.database().connect(); var statement = observation.prepareStatement(waitingChain)) {
            statement.setInt(1, gatePid);
            while (System.nanoTime() < deadline) {
                try (var row = statement.executeQuery()) {
                    if (!row.next()) throw new AssertionError("PostgreSQL returned no lock-wait observation");
                    blocked = row.getLong(1);
                }
                if (blocked >= expected) return;
                Thread.yield();
            }
        }
        fail("Expected " + expected + " PostgreSQL transactions blocked by the User-row gate but saw " + blocked);
    }

    private String passwordHash(AuthApi.User user) throws SQLException {
        return api.database().single("SELECT password_hash FROM users WHERE username = ?",
                String.class, user.username());
    }

    private String storedEmail(AuthApi.User user) throws SQLException {
        return api.database().single("SELECT email FROM users WHERE username = ?", String.class, user.username());
    }

    private long eventCount(AuthApi.User user, String type) throws SQLException {
        return api.database().single("SELECT count(*) FROM security_audit_events "
                + "WHERE subject_user_id = ? AND event_type = ?", Long.class, api.userId(user), type);
    }

    private static String newPassword(String prefix) {
        return prefix + UUID.randomUUID().toString().substring(0, 12);
    }

    private static String nextCode(String code) {
        return String.format(java.util.Locale.ROOT, "%06d", (Integer.parseInt(code) + 1) % 1_000_000);
    }

    private static List<HttpResponse<String>> parallel(int count, Callable<HttpResponse<String>> request)
            throws Exception {
        var start = new CountDownLatch(1);
        try (ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<HttpResponse<String>>> futures = new ArrayList<>();
            for (int index = 0; index < count; index++) {
                futures.add(workers.submit(() -> {
                    start.await();
                    return request.call();
                }));
            }
            start.countDown();
            List<HttpResponse<String>> responses = new ArrayList<>(count);
            for (var future : futures) responses.add(future.get(25, TimeUnit.SECONDS));
            return responses;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class AdvancingClockConfiguration {
        @Bean
        @Primary
        SteppingClock recoveryConcurrencyClock() {
            return new SteppingClock(Instant.now(), Duration.ofMinutes(1), new AtomicLong(), ZoneOffset.UTC);
        }
    }

    /** Advances one minute per clock read so per-user resend throttling cannot hide the ten-address limit. */
    static final class SteppingClock extends Clock {
        private volatile Instant base;
        private final Duration tick;
        private final AtomicLong reads;
        private final ZoneId zone;

        private SteppingClock(Instant base, Duration tick, AtomicLong reads, ZoneId zone) {
            this.base = base;
            this.tick = tick;
            this.reads = reads;
            this.zone = zone;
        }

        void restartAt(Instant instant) {
            base = instant;
            reads.set(0);
        }

        @Override public Instant instant() { return base.plus(tick.multipliedBy(reads.getAndIncrement())); }
        @Override public ZoneId getZone() { return zone; }
        @Override public Clock withZone(ZoneId zone) { return new SteppingClock(base, tick, reads, zone); }
    }
}
