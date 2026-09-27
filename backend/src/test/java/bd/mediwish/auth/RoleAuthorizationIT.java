package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.User;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static org.assertj.core.api.Assertions.assertThat;

/** Roles are read from PostgreSQL on every request, so a role change applies to an access token already issued. */
@Tag("integration")
@Tag("security")
@ExtendWith(AuthApi.Shared.class)
class RoleAuthorizationIT {
    private final AuthApi api;

    RoleAuthorizationIT(AuthApi api) {
        this.api = api;
    }

    @Test
    void anIssuedAccessTokenFollowsTheUsersCurrentRoles() throws Exception {
        User user = api.registered();
        String accessToken = api.signIn(user).accessToken();

        assertError(api.staffMe(accessToken), 403, "ACCESS_DENIED");
        api.grantRole(user, "ADMIN");
        assertError(api.staffMe(accessToken), 403, "MFA_REQUIRED");
        assertError(api.profile(accessToken), 403, "MFA_REQUIRED");
        api.removeRole(user, "ADMIN");
        assertThat(api.profile(accessToken).statusCode()).isEqualTo(200);
        assertError(api.staffMe(accessToken), 403, "ACCESS_DENIED");
    }
}
