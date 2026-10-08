package bd.mediwish.auth;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Direct requests cannot bypass single-role, MFA, ownership or input boundaries. Pricing is owned by Ticket14. */
@Tag("integration")
@Tag("regression")
@Tag("security")
@ExtendWith(OutputCaptureExtension.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class StaffRoleRegressionIT {
    private final AuthApi api = AuthApi.start();
    private final AuthApi.VerifiedStaff owner;
    private final AuthApi.VerifiedStaff admin;
    StaffRoleRegressionIT() throws Exception { owner = api.verifiedSuperAdmin(); admin = api.verifiedAdmin(); }
    @AfterAll void close() throws Exception { api.close(); }

    @Test void aModeratorCannotReadOrChangeRolesEvenForTheirOwnCurrentRole(CapturedOutput output) throws Exception {
        var user = api.registered();
        api.grantRole(user, "MODERATOR");
        String token = api.enroll(user).session().accessToken();
        UUID id = api.userId(user);
        var target = api.registered();
        assertError(api.adminUsers(token, Map.of()), 403, "ACCESS_DENIED");
        assertError(api.adminUser(token, id), 403, "ACCESS_DENIED");
        assertError(api.putRole(token, id, "ADMIN", 0), 403, "ACCESS_DENIED");
        assertError(api.putRole(token, id, "MODERATOR", 0), 403, "ACCESS_DENIED");
        assertError(api.putRole(token, api.userId(target), "MODERATOR", 0), 403, "ACCESS_DENIED");
        assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE actor_user_id = ?", Long.class, id)).isZero();
        api.assertLogsOmitSecrets(output);
    }

    @Test void onlyTheOwnerChangesAdminAndSelfAndSuperAdminStayProtected(CapturedOutput output) throws Exception {
        UUID adminId = api.userId(admin.user());
        UUID ownerId = api.userId(owner.user());
        var target = api.registered();
        UUID id = api.userId(target);
        for (String role : List.of("CUSTOMER", "DELIVERY_PERSON", "MODERATOR")) {
            assertError(api.putRole(admin.token(), adminId, role, 0), 409, "ROLE_CHANGE_REFUSED");
            assertError(api.putRole(owner.token(), ownerId, role, 0), 409, "ROLE_CHANGE_REFUSED");
            assertError(api.putRole(admin.token(), ownerId, role, 0), 409, "ROLE_CHANGE_REFUSED");
        }
        assertThat(api.putRole(admin.token(), adminId, "ADMIN", 99).statusCode()).isEqualTo(200);
        assertThat(api.putRole(admin.token(), ownerId, "ADMIN", 99).statusCode()).isEqualTo(200);
        assertError(api.putRole(admin.token(), id, "ADMIN", 99), 409, "ROLE_CHANGE_REFUSED");
        assertThat(api.putRole(owner.token(), id, "ADMIN", 0).statusCode()).isEqualTo(200);
        for (String role : List.of("CUSTOMER", "DELIVERY_PERSON", "MODERATOR"))
            assertError(api.putRole(admin.token(), id, role, 1), 409, "ROLE_CHANGE_REFUSED");
        assertThat(api.putRole(owner.token(), id, "MODERATOR", 1).statusCode()).isEqualTo(200);
        assertThat(api.putRole(owner.token(), id, "CUSTOMER", 2).statusCode()).isEqualTo(200);
        assertThat(api.database().single("SELECT super_admin_user_id FROM staff_bootstrap WHERE id = 1", UUID.class)).isEqualTo(ownerId);
        assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id = ?", Long.class, id)).isEqualTo(3);
        assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id IN (?, ?)",
                Long.class, ownerId, adminId)).isZero();
        api.assertLogsOmitSecrets(output);
    }

    @Test void restrictedSessionsAndUntrustedJsonCannotEnterTheRoleCommand(CapturedOutput output) throws Exception {
        var restricted = api.session(api.login(admin.user().username(), admin.user().password()), "VERIFICATION_REQUIRED");
        var target = api.registered();
        UUID id = api.userId(target);
        assertError(api.adminUsers(restricted.accessToken(), Map.of()), 403, "MFA_REQUIRED");
        assertError(api.adminUser(restricted.accessToken(), id), 403, "MFA_REQUIRED");
        assertError(api.putRole(restricted.accessToken(), id, "CUSTOMER", 0), 403, "MFA_REQUIRED");
        assertError(api.profile(restricted.accessToken()), 403, "MFA_REQUIRED");
        assertError(api.staffMe(restricted.accessToken()), 403, "MFA_REQUIRED");
        String path = "/api/admin/users/" + id + "/roles";
        Map<String, String> headers = Map.of("Authorization", "Bearer " + admin.token(), "Content-Type", "application/json");
        for (String body : List.of("{\"role\":\"ADMIN\",\"rolesVersion\":0,\"roles\":[\"ADMIN\"],\"superAdmin\":true}",
                "{\"staffRoles\":[\"MODERATOR\"],\"rolesVersion\":0}",
                "{\"role\":\"MODERATOR\",\"rolesVersion\":\"0\"}",
                "{\"role\":\"MODERATOR\",\"rolesVersion\":1.5}",
                "{\"role\":\"SUPER_ADMIN\",\"rolesVersion\":0}",
                "{\"role\":\"MODERATOR\",\"rolesVersion\":0}" + " ".repeat(17 * 1024)))
            assertError(api.send("PUT", path, headers, body), 400, "INVALID_REQUEST");
        assertError(api.send("PUT", path, Map.of("Authorization", "Bearer " + admin.token(), "Content-Type", "text/plain"), "ignored"), 400, "INVALID_REQUEST");
        assertError(api.post("/api/admin/users/search", headers, "{\"username\":\"\"}"), 400, "INVALID_REQUEST");
        assertError(api.post("/api/admin/users/search", headers, "{}" + " ".repeat(17 * 1024)), 400, "INVALID_REQUEST");
        assertThat(json(api.adminUser(admin.token(), id))).containsEntry("role", "CUSTOMER");
        assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id = ?", Long.class, id)).isZero();
        var session = api.signIn(target);
        api.database().update("DELETE FROM users WHERE id = ?", id);
        assertError(api.profile(session.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        api.assertLogsOmitSecrets(output);
    }
}
