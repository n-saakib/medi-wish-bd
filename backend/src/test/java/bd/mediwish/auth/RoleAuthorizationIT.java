package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.User;
import bd.mediwish.web.AdminOnlyProfileTestConfiguration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static org.assertj.core.api.Assertions.assertThat;

/** Roles are read from PostgreSQL on every request, so a role change applies to an access token already issued. */
@Tag("integration")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RoleAuthorizationIT {
    private final AuthApi api = AuthApi.start(AdminOnlyProfileTestConfiguration.class);

    @AfterAll
    void close() throws Exception {
        api.close();
    }

    @Test
    void anIssuedAccessTokenFollowsTheUsersCurrentRoles() throws Exception {
        User user = api.registered();
        String accessToken = api.signIn(user).accessToken();

        assertError(api.profile(accessToken), 403, "ACCESS_DENIED");
        replaceRole(user, "CUSTOMER", "ADMIN");
        assertThat(api.profile(accessToken).statusCode()).isEqualTo(200);
        replaceRole(user, "ADMIN", "CUSTOMER");
        assertError(api.profile(accessToken), 403, "ACCESS_DENIED");
    }

    private void replaceRole(User user, String from, String to) throws Exception {
        assertThat(api.database().update("UPDATE user_roles SET role = ? WHERE user_id = ? AND role = ?",
                to, api.userId(user), from)).isOne();
    }
}
