package bd.mediwish.auth;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.time.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

/** Real HTTP/PostgreSQL recovery contracts; held User locks prove actual transaction overlap. */
@Tag("integration") @Tag("security") @Tag("contract")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class StaffMfaRecoveryIT {
    private final AuthApi api;
    StaffMfaRecoveryIT(AuthApi api) { this.api = api; }
    @AfterEach void logsOmitSecrets(CapturedOutput output) { api.assertLogsOmitSecrets(output); }

    @Test void i1TheSameBackupCodeRacedFromTwoSessionsRecoversOnlyOnce() throws Exception {
        var user = staff(api, "MODERATOR"); var enrolled = api.enroll(user);
        var first = challenge(api, user); var second = challenge(api, user);
        List<HttpResponse<String>> results;
        try (var gate = lockUser(api.userId(user)); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var one = executor.submit(() -> api.useBackupCode(first.accessToken(), enrolled.backupCodes().getFirst()));
            var two = executor.submit(() -> api.useBackupCode(second.accessToken(), enrolled.backupCodes().getFirst()));
            // Both requests must reach PostgreSQL before either may consume the code.
            try { awaitBlocked(gate, 2); } finally { gate.rollback(); }
            results = List.of(one.get(10, TimeUnit.SECONDS), two.get(10, TimeUnit.SECONDS));
        }
        assertThat(results).extracting(HttpResponse::statusCode).containsExactlyInAnyOrder(200, 400);
        for (var response : results) {
            if (response.statusCode() == 200) api.session(response, "REPLACEMENT_REQUIRED");
            else assertError(response, 400, "MFA_CODE_INVALID");
        }
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_backup_codes b JOIN staff_mfa_factors f "
                + "ON f.id=b.factor_id WHERE f.user_id=? AND b.consumed_at IS NOT NULL", Long.class, api.userId(user))).isOne();
        assertThat(events(api, user, "MFA_RECOVERY_STARTED")).isOne();
        assertThat(events(api, user, "MFA_RECOVERY_CODE_REJECTED")).isOne();
    }

    @Test void i1CompletingTheReplacementRevokesTheOldFactorCodesAndSessions() throws Exception {
        var user = staff(api, "MODERATOR"); api.verifyMobile(user); var enrolled = api.enroll(user);
        var second = api.session(api.verifyMfa(challenge(api, user).accessToken(), api.authenticatorCode(enrolled.secret(), 1)), "VERIFIED");
        UUID oldFactor = activeFactor(api, user);
        var live = api.database().query("SELECT id FROM user_sessions WHERE user_id=? AND revoked_at IS NULL",
                row -> row.getObject(1, UUID.class), api.userId(user));
        api.notifier().clear(); var replaced = api.replace(user, enrolled);
        assertThat(replaced.contactNotice()).isEqualTo("SENT");
        for (var old : List.of(enrolled.session(), second)) {
            assertError(api.profile(old.accessToken()), 401, "AUTHENTICATION_REQUIRED");
            var refresh = api.refresh(old.refreshToken()); assertError(refresh, 401, "AUTHENTICATION_REQUIRED");
            AuthApi.assertRefreshCookieCleared(refresh);
        }
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_factors WHERE id=? AND status='REVOKED' AND revoked_at IS NOT NULL", Long.class, oldFactor)).isOne();
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id=?", Long.class, oldFactor)).isZero();
        UUID fresh = activeFactor(api, user); assertThat(fresh).isNotEqualTo(oldFactor);
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id=? AND consumed_at IS NULL", Long.class, fresh)).isEqualTo(10);
        for (UUID id : live) assertThat(api.database().single("SELECT revoked_reason FROM user_sessions WHERE id=?", String.class, id)).isEqualTo("mfa-replaced");
        assertThat(events(api, user, "MFA_FACTOR_REPLACED")).isOne();
        assertThat(api.notifier().notices()).singleElement().satisfies(notice -> {
            assertThat(notice.mobile()).isEqualTo(user.mobile());
            assertThat(notice.text()).doesNotContain(user.username(), enrolled.secret(), replaced.secret());
            for (String code : enrolled.backupCodes()) assertThat(notice.text()).doesNotContain(code, BackupCodes.normalize(code));
            for (String code : replaced.backupCodes()) assertThat(notice.text()).doesNotContain(code, BackupCodes.normalize(code));
        });
        String token = challenge(api, user).accessToken();
        assertError(api.verifyMfa(token, wrongForNewFactor(api, enrolled.secret(), replaced.secret())), 400, "MFA_CODE_INVALID");
        assertError(api.useBackupCode(token, enrolled.backupCodes().get(1)), 400, "MFA_CODE_INVALID");
        var verified = api.session(api.verifyMfa(token, api.authenticatorCode(replaced.secret(), 1)), "VERIFIED");
        assertThat(api.staffMe(verified.accessToken()).statusCode()).isEqualTo(200);
    }

    @Test void theReplacementSessionCanOnlySetUpTheNewAuthenticator() throws Exception {
        var user = staff(api, "ADMIN"); var enrolled = api.enroll(user);
        var replacing = api.session(api.useBackupCode(challenge(api, user).accessToken(), enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
        String token = replacing.accessToken();
        assertError(api.staffMe(token), 403, "MFA_REQUIRED"); assertError(api.adminUsers(token, Map.of()), 403, "MFA_REQUIRED");
        assertError(api.profile(token), 403, "MFA_REQUIRED");
        assertError(api.useBackupCode(token, enrolled.backupCodes().get(1)), 403, "MFA_REQUIRED");
        assertError(api.regenerateBackupCodes(token, api.authenticatorCode(enrolled.secret(), 1)), 403, "MFA_REQUIRED");
        assertError(api.verifyMfa(token, api.authenticatorCode(enrolled.secret(), 1)), 403, "MFA_REQUIRED");
        Instant expiry = replacementExpiry(api, user);
        var rotated = api.session(api.refresh(replacing.refreshToken()), "REPLACEMENT_REQUIRED");
        assertThat(replacementExpiry(api, user)).isEqualTo(expiry); api.startEnrollment(rotated.accessToken());
    }

    @ParameterizedTest
    @ValueSource(strings = {"ANONYMOUS", "CUSTOMER", "DELIVERY_PERSON", "ENROLLMENT_REQUIRED", "VERIFICATION_REQUIRED", "REPLACEMENT_REQUIRED", "VERIFIED"})
    void contractShapesRespectTheActorMatrix(String actor) throws Exception {
        String token = null;
        if (!actor.equals("ANONYMOUS")) {
            var user = staff(api, actor.equals("CUSTOMER") || actor.equals("DELIVERY_PERSON") ? actor : "ADMIN");
            if (actor.equals("CUSTOMER") || actor.equals("DELIVERY_PERSON")) token = api.signIn(user).accessToken();
            else if (actor.equals("ENROLLMENT_REQUIRED")) token = api.session(api.login(user.username(), user.password()), actor).accessToken();
            else {
                var enrolled = api.enroll(user);
                token = actor.equals("VERIFIED") ? enrolled.session().accessToken() : challenge(api, user).accessToken();
                if (actor.equals("REPLACEMENT_REQUIRED")) token = api.session(api.useBackupCode(token, enrolled.backupCodes().getFirst()), actor).accessToken();
            }
        }
        var headers = token == null ? AuthApi.JSON_CONTENT : Map.of("Content-Type", "application/json", "Authorization", "Bearer " + token);
        int denied = actor.equals("ANONYMOUS") ? 401 : 403;
        String error = actor.equals("ANONYMOUS") ? "AUTHENTICATION_REQUIRED" : actor.endsWith("_REQUIRED") ? "MFA_REQUIRED" : "ACCESS_DENIED";
        boolean enroll = actor.equals("ENROLLMENT_REQUIRED") || actor.equals("REPLACEMENT_REQUIRED");
        var start = api.post("/api/auth/mfa/enrollment", headers, null);
        if (enroll) {
            assertThat(start.statusCode()).isEqualTo(201);
            assertThat(json(start)).containsOnlyKeys("enrollmentId", "secret", "otpauthUri", "expiresIn");
            api.track((String) json(start).get("secret"));
        } else assertError(start, denied, error);
        assertError(api.post("/api/auth/mfa/enrollment/verify", headers, "{\"enrollmentId\":\"bad-id\",\"code\":\"123456\"}"), enroll ? 400 : denied, enroll ? "INVALID_REQUEST" : error);
        for (String path : List.of("/api/auth/mfa/verify", "/api/auth/mfa/recovery", "/api/auth/mfa/backup-codes")) {
            boolean allowed = path.endsWith("backup-codes") ? actor.equals("VERIFIED") : actor.equals("VERIFICATION_REQUIRED");
            assertError(api.post(path, headers, "{}"), allowed ? 400 : denied, allowed ? "INVALID_REQUEST" : error);
        }
    }

    @Test void regenerationReplacesOnlyUnusedCodes() throws Exception {
        var user = staff(api, "ADMIN"); var enrolled = api.enroll(user);
        var abandoned = api.session(api.useBackupCode(challenge(api, user).accessToken(), enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
        UUID factor = activeFactor(api, user); String code = api.authenticatorCode(enrolled.secret(), 1);
        var response = api.regenerateBackupCodes(enrolled.session().accessToken(), code);
        assertThat(response.statusCode()).isEqualTo(200); assertThat(json(response)).containsOnlyKeys("backupCodes");
        var fresh = api.backupCodes(response); assertThat(fresh).doesNotContainAnyElementsOf(enrolled.backupCodes());
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id=? AND consumed_at IS NULL", Long.class, factor)).isEqualTo(10);
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id=? AND consumed_at IS NOT NULL", Long.class, factor)).isOne();
        assertError(api.regenerateBackupCodes(enrolled.session().accessToken(), code), 400, "MFA_CODE_INVALID");
        assertThat(api.staffMe(enrolled.session().accessToken()).statusCode()).isEqualTo(200);
        assertThat(api.refresh(abandoned.refreshToken()).statusCode()).isEqualTo(200);
        String token = challenge(api, user).accessToken();
        assertError(api.useBackupCode(token, enrolled.backupCodes().get(1)), 400, "MFA_CODE_INVALID");
        api.session(api.useBackupCode(token, fresh.getFirst()), "REPLACEMENT_REQUIRED");
    }

    @Test void superAdminMaySelfRecover(CapturedOutput output) throws Exception {
        try (var isolated = AuthApi.start()) {
            var admin = isolated.verifiedSuperAdmin(); var replaced = isolated.replace(admin.user(), admin.enrolled());
            assertThat(json(isolated.staffMe(replaced.session().accessToken()))).containsEntry("superAdmin", true).containsEntry("roles", List.of("ADMIN"));
            isolated.assertLogsOmitSecrets(output);
        }
    }

    @Test void abandonedRecoveryLeavesTheOldAuthenticatorWorking() throws Exception {
        var user = staff(api, "MODERATOR"); var enrolled = api.enroll(user); UUID original = activeFactor(api, user);
        var replacing = api.session(api.useBackupCode(challenge(api, user).accessToken(), enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
        var pending = api.startEnrollment(replacing.accessToken());
        api.database().update("UPDATE user_sessions SET expires_at=now()-interval '1 second' WHERE user_id=? AND mfa_replacing_factor_id IS NOT NULL", api.userId(user));
        assertError(api.profile(replacing.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        api.session(api.verifyMfa(challenge(api, user).accessToken(), api.authenticatorCode(enrolled.secret(), 1)), "VERIFIED");
        assertThat(activeFactor(api, user)).isEqualTo(original);
        var next = challenge(api, user);
        assertError(api.useBackupCode(next.accessToken(), enrolled.backupCodes().getFirst()), 400, "MFA_CODE_INVALID");
        var again = api.session(api.useBackupCode(next.accessToken(), enrolled.backupCodes().get(1)), "REPLACEMENT_REQUIRED");
        var newPending = api.startEnrollment(again.accessToken());
        assertThat(newPending.get("enrollmentId")).isNotEqualTo(pending.get("enrollmentId"));
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_factors WHERE id=?", Long.class, UUID.fromString((String) pending.get("enrollmentId")))).isZero();
    }

    @Test void aBackupCodeOfAnotherUserIsRejected() throws Exception {
        var owner = staff(api, "MODERATOR"); var ownerCodes = api.enroll(owner);
        var other = staff(api, "MODERATOR"); api.enroll(other);
        assertError(api.useBackupCode(challenge(api, other).accessToken(), ownerCodes.backupCodes().getFirst()), 400, "MFA_CODE_INVALID");
        assertThat(events(api, other, "MFA_RECOVERY_CODE_REJECTED")).isOne();
        assertThat(api.database().single("SELECT failed_count FROM staff_mfa_throttle WHERE user_id=?", Integer.class, api.userId(other))).isOne();
        api.session(api.useBackupCode(challenge(api, owner).accessToken(), ownerCodes.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
    }

    @Test void notifierDisabledReportsNotConfigured(CapturedOutput output) throws Exception {
        try (var isolated = AuthApi.start(Map.of("app.notification.security.adapter", "disabled"))) {
            var user = staff(isolated, "ADMIN"); isolated.verifyMobile(user);
            var replaced = isolated.replace(user, isolated.enroll(user)); assertThat(replaced.contactNotice()).isEqualTo("NOT_CONFIGURED");
            assertThat(events(isolated, user, "MFA_REPLACEMENT_NOTICE_NOT_CONFIGURED")).isOne();
            assertThat(isolated.staffMe(replaced.session().accessToken()).statusCode()).isEqualTo(200); isolated.assertLogsOmitSecrets(output);
        }
    }

    @Test void replacementRevokesTheOldAccessAndRefreshBeforeTheirNaturalExpiry(CapturedOutput output) throws Exception {
        try (var isolated = AuthApi.start(ControlledClock.class)) {
            var clock = isolated.app().bean(RecoveryClock.class); var user = staff(isolated, "MODERATOR"); var enrolled = isolated.enroll(user);
            var second = isolated.session(isolated.verifyMfa(challenge(isolated, user).accessToken(), isolated.authenticatorCode(enrolled.secret(), 1)), "VERIFIED");
            // Cross the used TOTP step while both old 15-minute access tokens remain valid.
            clock.advance(Duration.ofSeconds(60));
            assertThat(isolated.profile(enrolled.session().accessToken()).statusCode()).isEqualTo(200);
            assertThat(isolated.profile(second.accessToken()).statusCode()).isEqualTo(200);
            var replaced = isolated.replace(user, enrolled);
            for (var old : List.of(enrolled.session(), second)) {
                assertError(isolated.profile(old.accessToken()), 401, "AUTHENTICATION_REQUIRED");
                assertError(isolated.refresh(old.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
            }
            assertThat(isolated.staffMe(replaced.session().accessToken()).statusCode()).isEqualTo(200); isolated.assertLogsOmitSecrets(output);
        }
    }

    @Test void replacementRefreshNeverExtendsItsTenMinuteDeadline(CapturedOutput output) throws Exception {
        try (var isolated = AuthApi.start(ControlledClock.class)) {
            var clock = isolated.app().bean(RecoveryClock.class); var user = staff(isolated, "MODERATOR"); var enrolled = isolated.enroll(user);
            var replacing = isolated.session(isolated.useBackupCode(challenge(isolated, user).accessToken(), enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
            Instant deadline = replacementExpiry(isolated, user); clock.advance(Duration.ofMinutes(9));
            var refreshed = isolated.session(isolated.refresh(replacing.refreshToken()), "REPLACEMENT_REQUIRED", 60);
            assertThat(replacementExpiry(isolated, user)).isEqualTo(deadline); clock.advance(Duration.ofSeconds(61));
            assertError(isolated.profile(refreshed.accessToken()), 401, "AUTHENTICATION_REQUIRED");
            assertError(isolated.refresh(refreshed.refreshToken()), 401, "AUTHENTICATION_REQUIRED"); isolated.assertLogsOmitSecrets(output);
        }
    }

    @Test
    void recoveryFailuresCommitAndLockAtFive() throws Exception {
        var user = staff(api, "MODERATOR");
        var enrolled = api.enroll(user);
        String token = challenge(api, user).accessToken();
        // Eleven distinct valid codes cannot all occur in this ten-code fixture.
        String absent = "ABCDEFGHJKM".chars().mapToObj(letter -> "ZZZZ-ZZZ" + (char) letter)
                .filter(candidate -> !enrolled.backupCodes().contains(candidate)).findFirst().orElseThrow();
        for (int attempt = 1; attempt < 5; attempt++) {
            assertError(api.useBackupCode(token, absent), 400, "MFA_CODE_INVALID");
        }
        assertError(api.useBackupCode(token, absent), 429, "TOO_MANY_ATTEMPTS");
        assertError(api.useBackupCode(token, enrolled.backupCodes().getFirst()), 429, "TOO_MANY_ATTEMPTS");
        assertThat(api.database().single("SELECT failed_count FROM staff_mfa_throttle WHERE user_id=?",
                Integer.class, api.userId(user))).isEqualTo(5);
        assertThat(events(api, user, "MFA_RECOVERY_CODE_REJECTED")).isEqualTo(5);
        assertThat(events(api, user, "MFA_ATTEMPTS_LOCKED")).isOne();
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id=? "
                + "AND consumed_at IS NOT NULL", Long.class, activeFactor(api, user))).isZero();
    }

    @Test
    void restartingReplacementEnrollmentRejectsTheStaleId() throws Exception {
        var user = staff(api, "MODERATOR");
        var enrolled = api.enroll(user);
        UUID original = activeFactor(api, user);
        var replacing = api.session(api.useBackupCode(challenge(api, user).accessToken(),
                enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
        var first = api.startEnrollment(replacing.accessToken());
        var second = api.startEnrollment(replacing.accessToken());
        api.notifier().clear();
        assertError(api.verifyEnrollment(replacing.accessToken(), first.get("enrollmentId"),
                api.authenticatorCode((String) first.get("secret"), 0)), 409, "MFA_ENROLLMENT_STALE");
        assertThat(activeFactor(api, user)).isEqualTo(original);
        assertThat(events(api, user, "MFA_FACTOR_REPLACED")).isZero();
        assertThat(api.notifier().notices()).isEmpty();
        var response = api.verifyEnrollment(replacing.accessToken(), second.get("enrollmentId"),
                api.authenticatorCode((String) second.get("secret"), 0));
        var verified = api.session(response, "VERIFIED");
        api.backupCodes(response);
        assertThat(json(response)).containsEntry("contactNotice", "NO_VERIFIED_CONTACT");
        assertThat(api.staffMe(verified.accessToken()).statusCode()).isEqualTo(200);
    }
    private static AuthApi.User staff(AuthApi api, String role) throws Exception {
        var user = api.registered(); if (!role.equals("CUSTOMER")) api.grantRole(user, role); return user;
    }
    private static AuthApi.Session challenge(AuthApi api, AuthApi.User user) throws Exception {
        return api.session(api.login(user.username(), user.password()), "VERIFICATION_REQUIRED");
    }
    private static UUID activeFactor(AuthApi api, AuthApi.User user) throws Exception {
        return api.database().single("SELECT id FROM staff_mfa_factors WHERE user_id=? AND status='ACTIVE'", UUID.class, api.userId(user));
    }
    private static Instant replacementExpiry(AuthApi api, AuthApi.User user) throws Exception {
        return api.database().query("SELECT expires_at FROM user_sessions WHERE user_id=? AND mfa_replacing_factor_id IS NOT NULL",
                row -> row.getTimestamp(1).toInstant(), api.userId(user)).getFirst();
    }
    private static long events(AuthApi api, AuthApi.User user, String event) throws Exception {
        return api.database().single("SELECT count(*) FROM security_audit_events WHERE subject_user_id=? AND event_type=?", Long.class, api.userId(user), event);
    }
    private static String wrongForNewFactor(AuthApi api, String oldSecret, String newSecret) {
        for (int offset : List.of(0, -1, 1)) {
            String code = api.authenticatorCode(oldSecret, offset);
            if (List.of(-1, 0, 1).stream().noneMatch(step -> api.authenticatorCode(newSecret, step).equals(code))) return code;
        }
        throw new AssertionError("Synthetic old and new TOTP windows unexpectedly coincide");
    }
    private Connection lockUser(UUID id) throws Exception {
        var connection = api.database().connect();
        try {
            connection.setAutoCommit(false);
            try (var statement = connection.prepareStatement("SELECT id FROM users WHERE id=? FOR UPDATE")) {
                statement.setObject(1, id); try (var row = statement.executeQuery()) { assertThat(row.next()).isTrue(); }
            }
            return connection;
        } catch (Exception failure) { connection.close(); throw failure; }
    }
    private void awaitBlocked(Connection gate, int count) throws Exception {
        int pid;
        try (var statement = gate.createStatement(); var row = statement.executeQuery("SELECT pg_backend_pid()")) { assertThat(row.next()).isTrue(); pid = row.getInt(1); }
        String sql = """
                WITH RECURSIVE blocked(pid) AS (
                  SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND ?=ANY(pg_blocking_pids(pid))
                  UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
                  WHERE a.datname=current_database() AND a.usename=current_user
                ) SELECT count(*) FROM blocked
                """;
        long deadline = System.nanoTime() + Duration.ofSeconds(6).toNanos();
        while (System.nanoTime() < deadline) {
            if (api.database().single(sql, Long.class, pid) >= count) return; Thread.sleep(20);
        }
        fail("Expected both recovery HTTP requests to block in PostgreSQL before releasing the User lock");
    }
    @TestConfiguration(proxyBeanMethods = false)
    static class ControlledClock { @Bean @Primary RecoveryClock recoveryClock() { return new RecoveryClock(); } }
    static final class RecoveryClock extends Clock {
        private volatile Instant now = Instant.parse("2026-10-19T06:00:00Z");
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public Instant instant() { return now; }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(now, zone); }
    }
}
