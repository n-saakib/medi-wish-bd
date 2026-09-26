package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.Session;
import bd.mediwish.auth.AuthApi.User;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static org.assertj.core.api.Assertions.assertThat;

/** Session state lives in PostgreSQL, so a restarted application honours it; this class owns its own context. */
@Tag("integration")
@Tag("recovery")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SessionRestartIT {
    private final AuthApi api = AuthApi.start();

    @AfterAll
    void close() throws Exception {
        api.close();
    }

    @Test
    void activeRevokedAndConsumedSessionStateSurvivesARestart() throws Exception {
        User user = api.registered();
        Session initial = api.signIn(user);
        Session rotated = api.session(api.refresh(initial.refreshToken()));
        Session loggedOut = api.signIn(user);
        assertThat(api.logout(loggedOut.refreshToken()).statusCode()).isEqualTo(204);

        api.app().restart();

        assertThat(api.profile(rotated.accessToken()).statusCode()).isEqualTo(200);
        assertError(api.profile(loggedOut.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(loggedOut.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(initial.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        assertThat(api.revoked(user, RevocationReason.REFRESH_REPLAY)).isOne();
        assertError(api.profile(rotated.accessToken()), 401, "AUTHENTICATION_REQUIRED");
    }
}
