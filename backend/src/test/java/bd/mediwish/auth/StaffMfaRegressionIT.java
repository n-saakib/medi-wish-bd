package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.User;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Ways around staff MFA that must stay closed, and the recovery paths an operator relies on (Ticket 06, T6). */
@Tag("integration")
@Tag("regression")
@Tag("security")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class StaffMfaRegressionIT {
    private final AuthApi api;

    StaffMfaRegressionIT(AuthApi api) {
        this.api = api;
    }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void r1aAndR1bARefreshNeverCarriesAPasswordSessionIntoStaffAccess() throws Exception {
        User user = api.registered();
        var customer = api.signIn(user);
        api.grantRole(user, "ADMIN");

        // The password session keeps its own lifetime; only what it may do changes.
        var promoted = api.session(api.refresh(customer.refreshToken()), "ENROLLMENT_REQUIRED",
                AuthApi.REFRESH_LIFETIME_SECONDS);
        assertError(api.staffMe(promoted.accessToken()), 403, "MFA_REQUIRED");

        api.enroll(user);
        var stillPassword = api.session(api.refresh(promoted.refreshToken()), "VERIFICATION_REQUIRED",
                AuthApi.REFRESH_LIFETIME_SECONDS);
        assertError(api.staffMe(stillPassword.accessToken()), 403, "MFA_REQUIRED");
    }

    @Test
    void r1eAUserWhoLosesTheStaffRoleMidFlowCannotVerify() throws Exception {
        User admin = staff();
        var restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED");
        var enrollment = api.startEnrollment(restricted.accessToken());

        api.removeRole(admin, "ADMIN");

        assertError(api.verifyEnrollment(restricted.accessToken(), enrollment.get("enrollmentId"),
                AuthApi.totp((String) enrollment.get("secret"), 0)), 403, "ACCESS_DENIED");
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_factors WHERE user_id = ? "
                + "AND status = 'ACTIVE'", Long.class, api.userId(admin))).isZero();
    }

    @Test
    void anotherAdminIsNeverTheSuperAdmin() throws Exception {
        User admin = staff();
        var enrolled = api.enroll(admin);

        assertThat(json(api.staffMe(enrolled.session().accessToken()))).containsEntry("superAdmin", false);
    }

    @Test
    void noHttpRouteProvisionsOrSetsUpAnAdmin() throws Exception {
        User user = api.registered();
        String accessToken = api.signIn(user).accessToken();
        Map<String, String> headers = Map.of("Authorization", "Bearer " + accessToken,
                "Content-Type", "application/json");
        for (String path : List.of("/api/auth/bootstrap", "/api/admin/bootstrap", "/api/setup",
                "/api/staff/bootstrap")) {
            for (String method : List.of("GET", "POST")) {
                String body = method.equals("POST") ? "{\"username\":\"" + user.username() + "\"}" : null;
                assertThat(api.send(method, path, headers, body).statusCode()).as(method + " " + path)
                        .isGreaterThanOrEqualTo(400);
            }
        }
        assertThat(api.database().single("SELECT count(*) FROM user_roles WHERE user_id = ? AND role = 'ADMIN'",
                Long.class, api.userId(user))).isZero();
    }

    @Test
    void theLockoutEndsAndItsFailuresWereCommittedDespiteTheErrors() throws Exception {
        User admin = staff();
        var enrolled = api.enroll(admin);
        String challenge = challenge(admin);
        String wrong = "000000".equals(AuthApi.totp(enrolled.secret(), 0)) ? "111111" : "000000";

        for (int attempt = 1; attempt <= 5; attempt++) api.verifyMfa(challenge, wrong);
        UUID id = api.userId(admin);
        assertThat(api.database().single("SELECT failed_count FROM staff_mfa_throttle WHERE user_id = ?",
                Integer.class, id)).isEqualTo(5);
        assertThat(api.database().single("SELECT count(*) FROM security_audit_events WHERE subject_user_id = ? "
                + "AND event_type = 'MFA_VERIFICATION_FAILED'", Long.class, id)).isEqualTo(5);
        assertError(api.verifyMfa(challenge, AuthApi.totp(enrolled.secret(), 1)), 429, "TOO_MANY_ATTEMPTS");

        api.database().update("UPDATE staff_mfa_throttle SET locked_until = now() - interval '1 second' "
                + "WHERE user_id = ?", id);
        api.session(api.verifyMfa(challenge, AuthApi.totp(enrolled.secret(), 1)), "VERIFIED");
        assertThat(api.database().single("SELECT failed_count FROM staff_mfa_throttle WHERE user_id = ?",
                Integer.class, id)).isZero();
    }

    @Test
    void codeStepsMustIncreaseSoAnAcceptedOrOlderCodeIsRefused() throws Exception {
        User admin = staff();
        var enrolled = api.enroll(admin);
        String next = AuthApi.totp(enrolled.secret(), 1);
        String current = AuthApi.totp(enrolled.secret(), 0);

        api.session(api.verifyMfa(challenge(admin), next), "VERIFIED");

        assertError(api.verifyMfa(challenge(admin), next), 400, "MFA_CODE_INVALID");
        assertError(api.verifyMfa(challenge(admin), current), 400, "MFA_CODE_INVALID");
    }

    @Test
    void anExpiredEnrollmentOrRestrictedSessionCannotBeCompleted() throws Exception {
        User admin = staff();
        var restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED");
        var enrollment = api.startEnrollment(restricted.accessToken());
        String code = AuthApi.totp((String) enrollment.get("secret"), 0);

        api.database().update("UPDATE staff_mfa_factors SET pending_expires_at = now() WHERE user_id = ?",
                api.userId(admin));
        assertError(api.verifyEnrollment(restricted.accessToken(), enrollment.get("enrollmentId"), code),
                409, "MFA_ENROLLMENT_STALE");

        api.database().update("UPDATE user_sessions SET expires_at = now() WHERE user_id = ?", api.userId(admin));
        assertError(api.verifyEnrollment(restricted.accessToken(), enrollment.get("enrollmentId"), code),
                401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(restricted.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    @Test
    void afterALostEnrollmentResponseTheAdminSignsInAgainButTheBackupCodesAreNotShownAgain() throws Exception {
        User admin = staff();
        var restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED");
        var enrollment = api.startEnrollment(restricted.accessToken());
        String secret = (String) enrollment.get("secret");
        var lost = api.verifyEnrollment(restricted.accessToken(), enrollment.get("enrollmentId"),
                AuthApi.totp(secret, 0));
        assertThat(lost.statusCode()).isEqualTo(200);
        ((List<?>) json(lost).get("backupCodes")).forEach(code -> api.track((String) code));
        api.track((String) json(lost).get("accessToken"));

        assertError(api.profile(restricted.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(restricted.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        var verified = api.verifyMfa(challenge(admin), AuthApi.totp(secret, 1));
        api.session(verified, "VERIFIED");
        assertThat(json(verified)).doesNotContainKey("backupCodes");
    }

    @Test
    void malformedOversizedAndUnauthenticatedInputIsRejectedWithoutCounting() throws Exception {
        User admin = staff();
        String restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED")
                .accessToken();
        var enrollment = api.startEnrollment(restricted);

        assertError(api.verifyEnrollment(restricted, enrollment.get("enrollmentId"), "١٢٣٤٥٦"), 400,
                "INVALID_REQUEST");
        assertError(api.verifyEnrollment(restricted, "not-a-uuid", "123456"), 400, "INVALID_REQUEST");
        assertError(api.verifyEnrollment(restricted, 42, "123456"), 400, "INVALID_REQUEST");
        assertError(api.post("/api/auth/mfa/enrollment/verify", Map.of("Authorization", "Bearer " + restricted,
                        "Content-Type", "application/json"), "{\"code\":\"" + "1".repeat(17 * 1024) + "\"}"),
                400, "INVALID_REQUEST");
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_throttle WHERE user_id = ?", Long.class,
                api.userId(admin))).isZero();
    }

    private User staff() throws Exception {
        User user = api.registered();
        api.grantRole(user, "ADMIN");
        return user;
    }

    private String challenge(User admin) throws Exception {
        return api.session(api.login(admin.username(), admin.password()), "VERIFICATION_REQUIRED").accessToken();
    }
}
