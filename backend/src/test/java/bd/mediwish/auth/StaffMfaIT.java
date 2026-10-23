package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.User;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Staff sign-in (Ticket 06): an Admin or Moderator role applies only to a session verified by their authenticator. */
@Tag("integration")
@Tag("security")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class StaffMfaIT {
    private final AuthApi api;

    StaffMfaIT(AuthApi api) {
        this.api = api;
    }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void aCustomerSignsInWithoutMfaAndCannotUseStaffRoutes() throws Exception {
        User user = api.registered();

        String accessToken = api.session(api.login(user.username(), user.password()), "NOT_REQUIRED").accessToken();

        assertThat(api.profile(accessToken).statusCode()).isEqualTo(200);
        assertError(api.staffMe(accessToken), 403, "ACCESS_DENIED");
        assertError(api.post("/api/auth/mfa/enrollment", Map.of("Authorization", "Bearer " + accessToken), null),
                403, "ACCESS_DENIED");
        assertError(api.verifyMfa(accessToken, "123456"), 403, "ACCESS_DENIED");
    }

    @Test
    void aDeliveryPersonIsNotStaffAndSignsInWithoutMfa() throws Exception {
        User courier = staff("DELIVERY_PERSON");

        String accessToken = api.session(api.login(courier.username(), courier.password()), "NOT_REQUIRED")
                .accessToken();

        assertThat(api.profile(accessToken).statusCode()).isEqualTo(200);
        assertError(api.staffMe(accessToken), 403, "ACCESS_DENIED");
        assertError(api.verifyMfa(accessToken, "123456"), 403, "ACCESS_DENIED");
    }

    @Test
    void anAdminWithoutAnAuthenticatorGetsAShortSessionThatMayOnlyEnroll() throws Exception {
        User admin = staff("ADMIN");

        String restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED")
                .accessToken();

        assertError(api.profile(restricted), 403, "MFA_REQUIRED");
        assertError(api.staffMe(restricted), 403, "MFA_REQUIRED");
        assertError(api.verifyMfa(restricted, "123456"), 403, "MFA_REQUIRED");
        var enrollment = api.startEnrollment(restricted);
        assertThat((String) enrollment.get("otpauthUri")).isEqualTo("otpauth://totp/Medi%20Wish:" + admin.username()
                + "?secret=" + enrollment.get("secret") + "&issuer=Medi%20Wish&algorithm=SHA1&digits=6&period=30");
    }

    @Test
    void enrollmentActivatesTheAuthenticatorReplacesTheSessionAndReturnsBackupCodesOnce() throws Exception {
        User admin = staff("ADMIN");
        var restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED");
        var enrollment = api.startEnrollment(restricted.accessToken());
        String secret = (String) enrollment.get("secret");

        assertError(api.verifyEnrollment(restricted.accessToken(), enrollment.get("enrollmentId"), wrongCode(secret)),
                400, "MFA_CODE_INVALID");
        var response = api.verifyEnrollment(restricted.accessToken(), enrollment.get("enrollmentId"),
                AuthApi.totp(secret, 0));
        var verified = api.session(response, "VERIFIED");

        assertThat(verified.user()).isEqualTo(admin.profile(false));
        assertError(api.profile(restricted.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        AuthApi.assertRefreshCookieCleared(api.refresh(restricted.refreshToken()));
        assertThat(json(api.staffMe(verified.accessToken())))
                .isEqualTo(Map.of("username", admin.username(), "roles", List.of("ADMIN"), "superAdmin", false));
        assertThat(api.profile(verified.accessToken()).statusCode()).isEqualTo(200);
        assertThat(api.revoked(admin, RevocationReason.MFA_VERIFIED)).isOne();

        var id = api.userId(admin);
        byte[] ciphertext = api.database().single("SELECT secret_ciphertext FROM staff_mfa_factors "
                + "WHERE user_id = ? AND status = 'ACTIVE'", byte[].class, id);
        assertThat(new String(ciphertext, StandardCharsets.ISO_8859_1)).doesNotContain(secret);
        assertThat(api.database().query("SELECT code_verifier FROM staff_mfa_backup_codes b "
                        + "JOIN staff_mfa_factors f ON f.id = b.factor_id WHERE f.user_id = ?",
                row -> row.getString(1), id)).hasSize(10).allMatch(verifier -> verifier.startsWith("$argon2id$"));
        assertThat(api.database().query("SELECT event_type FROM security_audit_events WHERE subject_user_id = ? "
                + "ORDER BY occurred_at", row -> row.getString(1), id))
                .containsExactly("MFA_ENROLLMENT_STARTED", "MFA_VERIFICATION_FAILED", "MFA_ENROLLMENT_ACTIVATED");
        assertThat(api.database().query("SELECT column_name FROM information_schema.columns "
                        + "WHERE table_schema = current_schema() AND table_name = 'security_audit_events' "
                        + "ORDER BY ordinal_position", row -> row.getString(1)))
                .as("no audit column could hold a secret")
                .containsExactly("id", "occurred_at", "event_type", "subject_user_id", "session_id", "request_id");
        assertThat(api.database().query("SELECT mfa_factor_id IS NOT NULL FROM user_sessions WHERE user_id = ? "
                + "ORDER BY created_at", row -> row.getBoolean(1), id)).as("only the new session is verified")
                .containsExactly(false, true);
    }

    @Test
    void anEnrolledAdminVerifiesEachSignInAndACodeIsAcceptedOnlyOnce() throws Exception {
        User admin = staff("ADMIN");
        var enrolled = api.enroll(admin);
        // Enrollment hashes ten backup codes before returning and can cross a 30-second boundary.
        // Replay the accepted step, rather than generating a possibly unused current-step code.
        long acceptedStep = api.database().single("SELECT last_used_step FROM staff_mfa_factors "
                + "WHERE user_id = ? AND status = 'ACTIVE'", Long.class, api.userId(admin));
        String usedCode = Totp.code(Base32.decode(enrolled.secret()), acceptedStep);

        String challenge = api.session(api.login(admin.username(), admin.password()), "VERIFICATION_REQUIRED")
                .accessToken();

        assertError(api.post("/api/auth/mfa/enrollment", Map.of("Authorization", "Bearer " + challenge), null),
                403, "MFA_REQUIRED");
        assertError(api.staffMe(challenge), 403, "MFA_REQUIRED");
        assertError(api.verifyMfa(challenge, usedCode), 400, "MFA_CODE_INVALID");
        var verified = api.session(api.verifyMfa(challenge, AuthApi.totp(enrolled.secret(), 1)), "VERIFIED");
        assertThat(api.staffMe(verified.accessToken()).statusCode()).isEqualTo(200);

        var rotated = api.session(api.refresh(verified.refreshToken()), "VERIFIED");
        assertThat(api.staffMe(rotated.accessToken()).statusCode()).as("refresh keeps the verification").isEqualTo(200);
    }

    @Test
    void aRestrictedSessionRefreshesOnlyForItsOwnShortLifetime() throws Exception {
        User moderator = staff("MODERATOR");
        var restricted = api.session(api.login(moderator.username(), moderator.password()), "ENROLLMENT_REQUIRED");

        var rotated = api.session(api.refresh(restricted.refreshToken()), "ENROLLMENT_REQUIRED");

        assertError(api.profile(rotated.accessToken()), 403, "MFA_REQUIRED");
    }

    @Test
    void aModeratorPassesMfaTheSameWay() throws Exception {
        User moderator = staff("MODERATOR");
        var enrolled = api.enroll(moderator);

        assertThat(json(api.staffMe(enrolled.session().accessToken())))
                .containsEntry("roles", List.of("MODERATOR")).containsEntry("superAdmin", false);
    }

    @Test
    void fiveWrongCodesLockVerificationEvenForTheRightCode() throws Exception {
        User admin = staff("ADMIN");
        var enrolled = api.enroll(admin);
        String challenge = api.session(api.login(admin.username(), admin.password()), "VERIFICATION_REQUIRED")
                .accessToken();
        String wrong = wrongCode(enrolled.secret());

        for (int attempt = 1; attempt <= 4; attempt++) {
            assertError(api.verifyMfa(challenge, wrong), 400, "MFA_CODE_INVALID");
        }
        assertError(api.verifyMfa(challenge, wrong), 429, "TOO_MANY_ATTEMPTS");
        assertError(api.verifyMfa(challenge, AuthApi.totp(enrolled.secret(), 1)), 429, "TOO_MANY_ATTEMPTS");
        assertThat(api.database().single("SELECT count(*) FROM security_audit_events WHERE subject_user_id = ? "
                + "AND event_type = 'MFA_ATTEMPTS_LOCKED'", Long.class, api.userId(admin))).isOne();

        api.clearMfaThrottle(admin);
        api.session(api.verifyMfa(challenge, AuthApi.totp(enrolled.secret(), 1)), "VERIFIED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "12345", "1234567", "12a456", "123-456"})
    void aMalformedCodeIsAnInvalidRequestThatIsNotCounted(String code) throws Exception {
        User admin = staff("ADMIN");
        String restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED")
                .accessToken();

        assertError(api.verifyEnrollment(restricted, api.startEnrollment(restricted).get("enrollmentId"), code),
                400, "INVALID_REQUEST");
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_throttle WHERE user_id = ?", Long.class,
                api.userId(admin))).isZero();
    }

    @Test
    void restartingEnrollmentMakesTheEarlierEnrollmentStale() throws Exception {
        User admin = staff("ADMIN");
        String restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED")
                .accessToken();
        var first = api.startEnrollment(restricted);
        var second = api.startEnrollment(restricted);

        assertError(api.verifyEnrollment(restricted, first.get("enrollmentId"),
                AuthApi.totp((String) first.get("secret"), 0)), 409, "MFA_ENROLLMENT_STALE");
        api.session(api.verifyEnrollment(restricted, second.get("enrollmentId"),
                AuthApi.totp((String) second.get("secret"), 0)), "VERIFIED");
    }

    @Test
    void losingTheStaffRoleOrTheAuthenticatorChangesAccessOnTheNextRequest() throws Exception {
        User admin = staff("ADMIN");
        var enrolled = api.enroll(admin);
        String verified = enrolled.session().accessToken();

        api.database().update("UPDATE staff_mfa_factors SET status = 'REVOKED', revoked_at = now() WHERE user_id = ?",
                api.userId(admin));
        assertError(api.staffMe(verified), 403, "MFA_REQUIRED");

        api.removeRole(admin, "ADMIN");
        assertThat(api.profile(verified).statusCode()).isEqualTo(200);
        assertError(api.staffMe(verified), 403, "ACCESS_DENIED");
    }

    @Test
    void mfaRoutesNeedNoCsrfTokenButDoNeedABearerToken() throws Exception {
        assertError(api.post("/api/auth/mfa/enrollment", Map.of(), null), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.post("/api/auth/mfa/verify", AuthApi.JSON_CONTENT, "{\"code\":\"123456\"}"),
                401, "AUTHENTICATION_REQUIRED");
    }

    private User staff(String role) throws Exception {
        User user = api.registered();
        api.grantRole(user, role);
        return user;
    }

    /** A six-digit code that matches no step near now. */
    private static String wrongCode(String secret) {
        List<String> near = List.of(AuthApi.totp(secret, -2), AuthApi.totp(secret, -1), AuthApi.totp(secret, 0),
                AuthApi.totp(secret, 1), AuthApi.totp(secret, 2));
        for (int candidate = 0; ; candidate++) {
            String code = String.format("%06d", candidate);
            if (!near.contains(code)) return code;
        }
    }
}
