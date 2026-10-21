package bd.mediwish.auth;

import bd.mediwish.notification.CaptureSecurityNotifier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.IntStream;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Ways around backup-code recovery that must stay closed, and its failure and role-change outcomes (Ticket 09, T6). */
@Tag("integration") @Tag("regression") @Tag("security") @Tag("recovery")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class StaffMfaRecoveryRegressionIT {
    private final AuthApi api;
    StaffMfaRecoveryRegressionIT(AuthApi api) { this.api = api; }
    @AfterEach void logsOmitSecrets(CapturedOutput output) { api.assertLogsOmitSecrets(output); }

    @Test void r1APasswordOnlySignInAfterRecoveryStillNeedsTheNewAuthenticator() throws Exception {
        var user = staff("MODERATOR"); var replaced = api.replace(user, api.enroll(user));
        var password = challenge(user);
        assertError(api.staffMe(password.accessToken()), 403, "MFA_REQUIRED");
        var refreshed = api.session(api.refresh(password.refreshToken()), "VERIFICATION_REQUIRED");
        assertError(api.staffMe(refreshed.accessToken()), 403, "MFA_REQUIRED");
        var verified = api.session(api.verifyMfa(refreshed.accessToken(), api.authenticatorCode(replaced.secret(), 1)), "VERIFIED");
        assertThat(api.staffMe(verified.accessToken()).statusCode()).isEqualTo(200);
    }

    @Test void r1AFailedNoticeNeverUndoesTheReplacement() throws Exception {
        var user = staff("MODERATOR"); api.verifyMobile(user); var enrolled = api.enroll(user); UUID old = activeFactor(api, user);
        api.notifier().clear(); api.notifier().failNext(CaptureSecurityNotifier.Failure.THROW);
        var replaced = api.replace(user, enrolled);
        assertThat(replaced.contactNotice()).isEqualTo("FAILED");
        assertReplaced(api, user, old, replaced);
        assertThat(api.notifier().notices()).isEmpty();
        assertThat(events(api, user, "MFA_REPLACEMENT_NOTICE_FAILED")).isOne();
    }

    @Test void r1AHungNoticeTimesOutWithoutUndoingTheReplacement(CapturedOutput output) throws Exception {
        try (var isolated = AuthApi.start(Map.of("app.notification.security.timeout", "PT1S"))) {
            var user = isolated.registered(); isolated.grantRole(user, "MODERATOR"); isolated.verifyMobile(user);
            var enrolled = isolated.enroll(user); UUID old = activeFactor(isolated, user);
            var replacing = isolated.session(isolated.useBackupCode(
                    isolated.session(isolated.login(user.username(), user.password()), "VERIFICATION_REQUIRED").accessToken(),
                    enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
            var pending = isolated.startEnrollment(replacing.accessToken()); String secret = (String) pending.get("secret");
            isolated.notifier().failNext(CaptureSecurityNotifier.Failure.HANG);
            long started = System.nanoTime();
            var response = isolated.verifyEnrollment(replacing.accessToken(), pending.get("enrollmentId"), isolated.authenticatorCode(secret, 0));
            Duration elapsed = Duration.ofNanos(System.nanoTime() - started);
            assertThat(elapsed).isLessThan(Duration.ofSeconds(3));
            var replaced = new AuthApi.Replaced(isolated.session(response, "VERIFIED"), secret, isolated.backupCodes(response),
                    (String) json(response).get("contactNotice"));
            assertThat(replaced.contactNotice()).isEqualTo("FAILED");
            assertReplaced(isolated, user, old, replaced);
            assertThat(events(isolated, user, "MFA_REPLACEMENT_NOTICE_FAILED")).isOne();
            isolated.assertLogsOmitSecrets(output);
        }
    }

    @Test void noVerifiedMobileCompletesWithNoVerifiedContact() throws Exception {
        var user = staff("ADMIN"); var enrolled = api.enroll(user); UUID old = activeFactor(api, user);
        api.notifier().clear(); var replaced = api.replace(user, enrolled);
        assertThat(replaced.contactNotice()).isEqualTo("NO_VERIFIED_CONTACT");
        assertReplaced(api, user, old, replaced);
        assertThat(api.notifier().notices()).isEmpty();
        assertThat(events(api, user, "MFA_REPLACEMENT_NOTICE_NO_VERIFIED_CONTACT")).isOne();
    }

    @Test void aRoleRemovedDuringRecoveryEndsItAndIsNotRestored() throws Exception {
        var admin = api.verifiedAdmin(); var user = staff("MODERATOR"); var enrolled = api.enroll(user);
        UUID id = api.userId(user); UUID old = activeFactor(api, user);
        var replacing = api.session(api.useBackupCode(challenge(user).accessToken(), enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
        assertThat(api.putRole(admin.token(), id, "CUSTOMER", rolesVersion(id)).statusCode()).isEqualTo(200);
        assertError(api.profile(replacing.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(replacing.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        api.signIn(user);
        assertThat(role(id)).isEqualTo("CUSTOMER"); assertThat(activeFactor(api, user)).isEqualTo(old);
        assertThat(liveReplacements(id)).isZero();
        assertThat(api.putRole(admin.token(), id, "MODERATOR", rolesVersion(id)).statusCode()).isEqualTo(200);
        var verified = api.session(api.verifyMfa(challenge(user).accessToken(), api.authenticatorCode(enrolled.secret(), 1)), "VERIFIED");
        assertThat(json(api.staffMe(verified.accessToken()))).containsEntry("roles", List.of("MODERATOR"));
        assertThat(activeFactor(api, user)).isEqualTo(old);
    }

    @Test void aRoleRemovedBetweenStartAndVerifyRefusesTheVerify() throws Exception {
        var admin = api.verifiedAdmin(); var user = staff("MODERATOR"); var enrolled = api.enroll(user);
        UUID id = api.userId(user); UUID old = activeFactor(api, user);
        var replacing = api.session(api.useBackupCode(challenge(user).accessToken(), enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
        var pending = api.startEnrollment(replacing.accessToken());
        assertThat(api.putRole(admin.token(), id, "CUSTOMER", rolesVersion(id)).statusCode()).isEqualTo(200);
        assertError(api.verifyEnrollment(replacing.accessToken(), pending.get("enrollmentId"),
                api.authenticatorCode((String) pending.get("secret"), 0)), 401, "AUTHENTICATION_REQUIRED");
        assertThat(activeFactor(api, user)).isEqualTo(old); assertThat(role(id)).isEqualTo("CUSTOMER");
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_factors WHERE id=? AND status='ACTIVE'", Long.class,
                UUID.fromString((String) pending.get("enrollmentId")))).isZero();
        assertThat(events(api, user, "MFA_FACTOR_REPLACED")).isZero();
    }

    @Test void aTicket10StyleResetMakesTheReplacementStale() throws Exception {
        var user = staff("MODERATOR"); var enrolled = api.enroll(user); UUID old = activeFactor(api, user);
        var replacing = api.session(api.useBackupCode(challenge(user).accessToken(), enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
        var pending = api.startEnrollment(replacing.accessToken());
        api.database().update("UPDATE staff_mfa_factors SET status='REVOKED', revoked_at=now() WHERE id=?", old);
        var downgraded = api.session(api.refresh(replacing.refreshToken()), "ENROLLMENT_REQUIRED");
        var response = api.verifyEnrollment(downgraded.accessToken(), pending.get("enrollmentId"),
                api.authenticatorCode((String) pending.get("secret"), 0));
        assertThat(response.statusCode()).isIn(403, 409);
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_factors WHERE user_id=? AND status='ACTIVE'",
                Long.class, api.userId(user))).isZero();
        assertThat(events(api, user, "MFA_FACTOR_REPLACED")).isZero();
    }

    @Test void lockoutIsSharedBetweenTotpAndBackupCodes() throws Exception {
        var user = staff("MODERATOR"); var enrolled = api.enroll(user); String token = challenge(user).accessToken();
        String wrongTotp = absentTotp(api, enrolled.secret());
        for (int attempt = 0; attempt < 3; attempt++) assertError(api.verifyMfa(token, wrongTotp), 400, "MFA_CODE_INVALID");
        String absent = absentBackupCode(enrolled.backupCodes());
        assertError(api.useBackupCode(token, absent), 400, "MFA_CODE_INVALID");
        assertError(api.useBackupCode(token, absent), 429, "TOO_MANY_ATTEMPTS");
        assertError(api.useBackupCode(token, enrolled.backupCodes().getFirst()), 429, "TOO_MANY_ATTEMPTS");
        assertThat(consumedCodes(user)).isZero();
    }

    @Test void malformedAndOversizedInputsAreNotCounted() throws Exception {
        var user = staff("ADMIN"); var enrolled = api.enroll(user); String token = challenge(user).accessToken();
        var headers = Map.of("Authorization", "Bearer " + token, "Content-Type", "application/json");
        List<String> bodies = List.of("{}", "{\"backupCode\":null}", "{\"backupCode\":12345678}", "{\"backupCode\":[\"ABCD-EFGH\"]}",
                "{\"backupCode\":{\"v\":\"ABCD-EFGH\"}}", "{\"backupCode\":\"\"}", "{\"backupCode\":\"ABCD-EFG\"}",
                "{\"backupCode\":\"ABCD-EFGHJ\"}", "{\"backupCode\":\"ABCD--EFGH\"}", "{\"backupCode\":\"AB-CD-EFGH\"}",
                "{\"backupCode\":\"ABCD-EFG1\"}", "{\"backupCode\":\"ABCD-EFGO\"}", "{\"backupCode\":\"ABCD-EFGI\"}",
                "{\"backupCode\":\"ABCD-EFGU\"}", "{\"backupCode\":\"ＡBCD-EFGH\"}", "{\"backupCode\":\"ABCD_EFGH\"}",
                "{\"backupCode\":\"ABCD-EFGH\",\"extra\":1}", "{\"code\":\"ABCD-EFGH\"}", "[]", "\"ABCD-EFGH\"");
        assertThat(bodies).hasSize(20);
        for (String body : bodies) assertError(api.post("/api/auth/mfa/recovery", headers, body), 400, "INVALID_REQUEST");
        assertError(api.post("/api/auth/mfa/recovery", headers, "{\"backupCode\":\"" + "A".repeat(17 * 1024) + "\"}"),
                400, "INVALID_REQUEST");
        assertThat(api.database().single("SELECT coalesce((SELECT failed_count FROM staff_mfa_throttle WHERE user_id=?), 0)",
                Integer.class, api.userId(user))).isZero();
        assertThat(events(api, user, "MFA_RECOVERY_CODE_REJECTED")).isZero();
        api.session(api.useBackupCode(token, enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
    }

    @Test void secretsStayOutOfLogsAuditAndErrors() throws Exception {
        var user = staff("MODERATOR"); api.verifyMobile(user); var enrolled = api.enroll(user);
        String token = challenge(user).accessToken();
        String wrong = absentBackupCode(enrolled.backupCodes());
        var refused = api.useBackupCode(token, wrong);
        assertError(refused, 400, "MFA_CODE_INVALID");
        assertThat(refused.body()).doesNotContain(wrong, BackupCodes.normalize(wrong));
        var replaced = api.replace(user, enrolled);
        var values = new ArrayList<>(List.of(user.username(), user.mobile(), user.password(), enrolled.secret(), replaced.secret(),
                enrolled.session().accessToken(), enrolled.session().refreshToken(), replaced.session().accessToken(),
                replaced.session().refreshToken(), wrong, BackupCodes.normalize(wrong)));
        for (String code : enrolled.backupCodes()) values.addAll(List.of(code, BackupCodes.normalize(code)));
        for (String code : replaced.backupCodes()) values.addAll(List.of(code, BackupCodes.normalize(code)));
        // The timestamp is left out: its microsecond digits could equal a six-digit TOTP by chance.
        String audit = String.join("\n", api.database().query("SELECT (to_jsonb(e) - 'occurred_at')::text FROM security_audit_events e "
                + "WHERE subject_user_id=?", row -> row.getString(1), api.userId(user)));
        assertThat(audit).contains("MFA_FACTOR_REPLACED", "MFA_RECOVERY_CODE_REJECTED");
        for (String value : values) assertThat(audit).as("an audit row holds a credential or contact").doesNotContain(value);
        for (int offset = -1; offset <= 1; offset++) {
            for (String secret : List.of(enrolled.secret(), replaced.secret())) {
                assertThat(Pattern.compile("(?<![A-Za-z0-9])" + api.authenticatorCode(secret, offset) + "(?![A-Za-z0-9])").matcher(audit).find())
                        .as("a TOTP code in an audit row").isFalse();
            }
        }
    }

    @Test void concurrentRecoveryAndRoleChangeEndInOneSafeState() throws Exception {
        var admin = api.verifiedAdmin();
        for (int round = 0; round < 3; round++) {
            var user = staff("MODERATOR"); var enrolled = api.enroll(user); UUID id = api.userId(user); UUID old = activeFactor(api, user);
            String token = challenge(user).accessToken(); long version = rolesVersion(id);
            var results = AuthApi.race(() -> api.useBackupCode(token, enrolled.backupCodes().getFirst()),
                    () -> api.putRole(admin.token(), id, "CUSTOMER", version));
            assertThat(results.get(1).statusCode()).isEqualTo(200);
            HttpResponse<String> recovery = results.getFirst();
            if (recovery.statusCode() == 200) {
                var replacing = api.session(recovery, "REPLACEMENT_REQUIRED");
                assertError(api.profile(replacing.accessToken()), 401, "AUTHENTICATION_REQUIRED");
                assertError(api.refresh(replacing.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
            } else {
                assertThat(recovery.statusCode()).isIn(401, 403);
            }
            assertThat(role(id)).isEqualTo("CUSTOMER"); assertThat(activeFactor(api, user)).isEqualTo(old);
            assertThat(liveReplacements(id)).isZero(); assertThat(events(api, user, "MFA_FACTOR_REPLACED")).isZero();
        }
    }

    private void assertReplaced(AuthApi on, AuthApi.User user, UUID old, AuthApi.Replaced replaced) throws Exception {
        assertThat(on.database().single("SELECT status FROM staff_mfa_factors WHERE id=?", String.class, old)).isEqualTo("REVOKED");
        UUID fresh = activeFactor(on, user); assertThat(fresh).isNotEqualTo(old);
        assertThat(replaced.backupCodes()).hasSize(10);
        assertThat(on.database().single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id=? AND consumed_at IS NULL",
                Long.class, fresh)).isEqualTo(10);
        assertThat(on.staffMe(replaced.session().accessToken()).statusCode()).isEqualTo(200);
        assertThat(events(on, user, "MFA_FACTOR_REPLACED")).isOne();
    }

    private AuthApi.User staff(String role) throws Exception {
        var user = api.registered(); api.grantRole(user, role); return user;
    }
    private AuthApi.Session challenge(AuthApi.User user) throws Exception {
        return api.session(api.login(user.username(), user.password()), "VERIFICATION_REQUIRED");
    }
    private long rolesVersion(UUID id) throws Exception {
        return api.database().single("SELECT roles_version FROM users WHERE id=?", Long.class, id);
    }
    private String role(UUID id) throws Exception {
        return api.database().single("SELECT role FROM user_roles WHERE user_id=?", String.class, id);
    }
    private long liveReplacements(UUID id) throws Exception {
        return api.database().single("SELECT count(*) FROM user_sessions WHERE user_id=? AND revoked_at IS NULL "
                + "AND mfa_replacing_factor_id IS NOT NULL", Long.class, id);
    }
    private long consumedCodes(AuthApi.User user) throws Exception {
        return api.database().single("SELECT count(*) FROM staff_mfa_backup_codes b JOIN staff_mfa_factors f ON f.id=b.factor_id "
                + "WHERE f.user_id=? AND b.consumed_at IS NOT NULL", Long.class, api.userId(user));
    }
    private static UUID activeFactor(AuthApi on, AuthApi.User user) throws Exception {
        return on.database().single("SELECT id FROM staff_mfa_factors WHERE user_id=? AND status='ACTIVE'", UUID.class, on.userId(user));
    }
    private static long events(AuthApi on, AuthApi.User user, String event) throws Exception {
        return on.database().single("SELECT count(*) FROM security_audit_events WHERE subject_user_id=? AND event_type=?",
                Long.class, on.userId(user), event);
    }
    /** A six-digit code outside the accepted window of the factor, so it is refused and counted. */
    private static String absentTotp(AuthApi on, String secret) {
        var window = IntStream.rangeClosed(-1, 1).mapToObj(offset -> on.authenticatorCode(secret, offset)).toList();
        return IntStream.range(0, 4).mapToObj(value -> String.format("%06d", value * 111_111))
                .filter(code -> !window.contains(code)).findFirst().orElseThrow();
    }
    /** Eleven distinct valid codes cannot all occur among ten. */
    private static String absentBackupCode(List<String> codes) {
        return "ABCDEFGHJKM".chars().mapToObj(letter -> "ZZZZ-ZZZ" + (char) letter)
                .filter(candidate -> !codes.contains(candidate)).findFirst().orElseThrow();
    }
}
