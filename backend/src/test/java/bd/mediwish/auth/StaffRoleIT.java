package bd.mediwish.auth;

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

/** The real role command joins registration, sessions, staff MFA and the customer/staff hierarchy. */
@Tag("integration")
@Tag("security")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class StaffRoleIT {
    private final AuthApi api;
    StaffRoleIT(AuthApi api) { this.api = api; }

    @Test
    void promotionRevokesBothDevicesAndDemotionKeepsTheAuthenticatorForFreshVerification(CapturedOutput output)
            throws Exception {
        var admin = api.verifiedAdmin();
        var customer = api.registered();
        UUID id = api.userId(customer);
        var first = api.signIn(customer);
        var second = api.signIn(customer);

        var changed = api.putRole(admin.token(), id, "MODERATOR", 0);
        assertThat(changed.statusCode()).isEqualTo(200);
        assertDetail(json(changed), id, customer.username(), "MODERATOR", 1L, "SETUP_REQUIRED");
        assertThat(api.database().query("SELECT role FROM user_roles WHERE user_id = ?",
                row -> row.getString(1), id)).containsExactly("MODERATOR");
        for (var old : List.of(first, second)) {
            assertError(api.profile(old.accessToken()), 401, "AUTHENTICATION_REQUIRED");
            assertError(api.refresh(old.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        }
        assertThat(api.revoked(customer, RevocationReason.ROLE_CHANGED)).isEqualTo(2);
        var restricted = api.session(api.login(customer.username(), customer.password()), "ENROLLMENT_REQUIRED");
        assertError(api.profile(restricted.accessToken()), 403, "MFA_REQUIRED");
        assertError(api.staffMe(restricted.accessToken()), 403, "MFA_REQUIRED");
        var enrollment = api.startEnrollment(restricted.accessToken());
        String secret = (String) enrollment.get("secret");
        var verified = api.session(api.verifyEnrollment(restricted.accessToken(), enrollment.get("enrollmentId"),
                AuthApi.totp(secret, 0)), "VERIFIED");
        assertThat(json(api.staffMe(verified.accessToken())))
                .isEqualTo(Map.of("username", customer.username(), "roles", List.of("MODERATOR"), "superAdmin", false));
        assertThat(api.profile(verified.accessToken()).statusCode()).isEqualTo(200);

        assertThat(api.putRole(admin.token(), id, "CUSTOMER", 1).statusCode()).isEqualTo(200);
        assertError(api.profile(verified.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        var demoted = api.signIn(customer);
        assertError(api.staffMe(demoted.accessToken()), 403, "ACCESS_DENIED");
        assertThat(api.putRole(admin.token(), id, "MODERATOR", 2).statusCode()).isEqualTo(200);
        var challenge = api.session(api.login(customer.username(), customer.password()), "VERIFICATION_REQUIRED");
        assertError(api.staffMe(challenge.accessToken()), 403, "MFA_REQUIRED");
        api.session(api.verifyMfa(challenge.accessToken(), AuthApi.totp(secret, 1)), "VERIFIED");
        assertThat(api.database().query("SELECT old_role || '->' || new_role FROM user_role_changes "
                + "WHERE target_user_id = ? ORDER BY occurred_at", row -> row.getString(1), id))
                .containsExactly("CUSTOMER->MODERATOR", "MODERATOR->CUSTOMER", "CUSTOMER->MODERATOR");
        assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id = ? "
                + "AND actor_user_id = ? AND request_id IS NOT NULL", Long.class, id, api.userId(admin.user())))
                .isEqualTo(3);
        assertThat(api.database().single("SELECT roles_version FROM users WHERE id = ?", Long.class, id)).isEqualTo(3);
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void aDeliveryPersonShopsWithoutMfaAndCannotManageUsers(CapturedOutput output) throws Exception {
        var admin = api.verifiedAdmin();
        var customer = api.registered();
        UUID id = api.userId(customer);
        var before = api.signIn(customer);
        assertThat(api.putRole(admin.token(), id, "DELIVERY_PERSON", 0).statusCode()).isEqualTo(200);
        assertError(api.profile(before.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        var delivery = api.signIn(customer);
        assertThat(api.profile(delivery.accessToken()).statusCode()).isEqualTo(200);
        assertError(api.staffMe(delivery.accessToken()), 403, "ACCESS_DENIED");
        assertError(api.adminUsers(delivery.accessToken(), Map.of()), 403, "ACCESS_DENIED");
        api.assertLogsOmitSecrets(output);
    }

    static void assertDetail(Map<String, Object> body, UUID id, String username, String role, long version,
                             String staffMfa) {
        assertThat(body).containsOnlyKeys("id", "username", "role", "staffMfa", "superAdmin", "createdAt",
                "rolesVersion", "self", "assignableRoles", "roleChanges")
                .containsEntry("id", id.toString()).containsEntry("username", username)
                .containsEntry("role", role).containsEntry("staffMfa", staffMfa)
                .containsEntry("self", false).containsEntry("superAdmin", false)
                .containsEntry("assignableRoles", List.of("CUSTOMER", "DELIVERY_PERSON", "MODERATOR"));
        assertThat(((Number) body.get("rolesVersion")).longValue()).isEqualTo(version);
    }
}
