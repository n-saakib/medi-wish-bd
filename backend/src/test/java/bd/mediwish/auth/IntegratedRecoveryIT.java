package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
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

/** Real HTTP/PostgreSQL boundaries where email recovery, staff replacement and public browsing meet. */
@Tag("integration")
@Tag("security")
@Tag("regression")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class IntegratedRecoveryIT {
    private final AuthApi api;

    IntegratedRecoveryIT(AuthApi api) { this.api = api; }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) throws Exception {
        api.drainMail();
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void passwordResetRevokesReplacementAndVerifiedSessionsWithoutRemovingTheAuthenticator() throws Exception {
        var fixture = replacement();
        var user = fixture.user();
        api.markEmailVerified(user);
        String password = api.track("integrated-reset-" + UUID.randomUUID());
        assertThat(api.requestReset(user.email()).statusCode()).isEqualTo(202);
        String code = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));

        assertThat(api.confirmReset(user.email(), code, password).statusCode()).isEqualTo(204);

        assertRevoked(fixture.replacing());
        assertRevoked(fixture.enrolled().session());
        assertError(api.login(user.username(), user.password()), 401, "AUTHENTICATION_FAILED");
        var challenge = api.session(api.login(user.username(), password), "VERIFICATION_REQUIRED");
        assertError(api.staffMe(challenge.accessToken()), 403, "MFA_REQUIRED");
        var verified = api.session(api.verifyMfa(challenge.accessToken(),
                api.authenticatorCode(fixture.enrolled().secret(), 1)), "VERIFIED");
        assertThat(api.staffMe(verified.accessToken()).statusCode()).isEqualTo(200);
    }

    @Test
    void verifiedEmailChangeRevokesAnotherReplacementFamilyAndKeepsTheSavingVerifiedSession() throws Exception {
        var fixture = replacement();
        var user = fixture.user();
        api.markEmailVerified(user);
        String email = api.track("integrated-change." + UUID.randomUUID() + "@example.test");
        String savingToken = fixture.enrolled().session().accessToken();

        var changed = api.putProfileWithPassword(savingToken, 0, null, email, null, user.password());

        assertThat(changed.statusCode()).isEqualTo(200);
        assertThat(json(changed)).containsEntry("email", email).containsEntry("emailVerified", false);
        assertRevoked(fixture.replacing());
        assertThat(api.profileOf(savingToken).statusCode()).isEqualTo(200);
        api.session(api.refresh(fixture.enrolled().session().refreshToken()), "VERIFIED");
        api.awaitMail(EmailKind.EMAIL_CHANGED, user.email());
    }

    @Test
    void publicCatalogIgnoresRestrictedAndRevokedBearerTokensWithoutOpeningProtectedMutations() throws Exception {
        var fixture = replacement();
        String token = fixture.replacing().accessToken();
        assertPublicCatalog(token);
        assertProtectedMutations(token, 403, "MFA_REQUIRED");

        assertThat(api.logout(fixture.replacing().refreshToken()).statusCode()).isEqualTo(204);

        assertPublicCatalog(token);
        assertProtectedMutations(token, 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(fixture.replacing().refreshToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    private Fixture replacement() throws Exception {
        var user = api.registered();
        api.grantRole(user, "MODERATOR");
        var enrolled = api.enroll(user);
        var challenge = api.session(api.login(user.username(), user.password()), "VERIFICATION_REQUIRED");
        var replacing = api.session(api.useBackupCode(challenge.accessToken(), enrolled.backupCodes().getFirst()),
                "REPLACEMENT_REQUIRED");
        return new Fixture(user, enrolled, replacing);
    }

    private void assertRevoked(AuthApi.Session session) throws Exception {
        assertError(api.profileOf(session.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        var refreshed = api.refresh(session.refreshToken());
        assertError(refreshed, 401, "AUTHENTICATION_REQUIRED");
        AuthApi.assertRefreshCookieCleared(refreshed);
    }

    private void assertPublicCatalog(String token) throws Exception {
        UUID missing = UUID.randomUUID();
        for (String path : List.of("/api/categories", "/api/categories/" + missing + "/products",
                "/api/products/" + missing)) {
            var anonymous = api.send("GET", path, Map.of(), null);
            var authenticated = api.send("GET", path, Map.of("Authorization", "Bearer " + token), null);
            if (path.equals("/api/categories")) {
                assertThat(anonymous.statusCode()).isEqualTo(200);
                assertThat(authenticated.statusCode()).isEqualTo(200);
                assertThat(json(authenticated)).isEqualTo(json(anonymous));
            } else {
                assertError(anonymous, 404, "NOT_FOUND");
                assertError(authenticated, 404, "NOT_FOUND");
            }
            assertThat(authenticated.headers().allValues("Set-Cookie")).isEmpty();
        }
    }

    private void assertProtectedMutations(String token, int status, String error) throws Exception {
        var headers = Map.of("Authorization", "Bearer " + token, "Content-Type", "application/json");
        assertError(api.profileOf(token), status, error);
        assertError(api.send("PUT", "/api/user/me/profile", headers, "{}"), status, error);
        assertError(api.send("POST", "/api/user/me/addresses", headers, "{}"), status, error);
    }

    private record Fixture(AuthApi.User user, AuthApi.Enrolled enrolled, AuthApi.Session replacing) {}
}
