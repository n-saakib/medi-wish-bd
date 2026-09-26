package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.Session;
import bd.mediwish.auth.AuthApi.User;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.assertOmits;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;

/** {@code GET /api/user/me}: the protected route, reached only with the Bearer token of a current session. */
@Tag("integration")
@Tag("security")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class ProfileIT {
    private static final String PROFILE = "/api/user/me";

    private final AuthApi api;

    ProfileIT(AuthApi api) {
        this.api = api;
    }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void theBearerReadsTheirOwnCurrentProfileWithoutTheTokenEchoed() throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);
        api.verifyMobile(user);

        var profile = api.profile(session.accessToken());

        assertThat(profile.statusCode()).isEqualTo(200);
        assertThat(json(profile)).isEqualTo(user.profile(true));
        assertOmits(profile, List.of(session.accessToken(), session.refreshToken()));
    }

    /** The access token names only the User and session; everything else is read from PostgreSQL per request. */
    @Test
    void theAccessTokenCarriesNoCredentialContactOrRole() throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);

        String payload = new String(Base64.getUrlDecoder().decode(session.accessToken().split("\\.")[1]),
                StandardCharsets.UTF_8);

        assertOmits("access token payload", payload, List.of(user.username(), user.mobile(), user.email(),
                user.password(), session.refreshToken(), "CUSTOMER"));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource
    void aRequestWithoutAUsableBearerTokenIsChallengedForOne(String problem, Map<String, String> headers)
            throws Exception {
        assertChallenged(api.send("GET", PROFILE, headers, null));
    }

    static Stream<Arguments> aRequestWithoutAUsableBearerTokenIsChallengedForOne() {
        return Stream.of(
                arguments("no Authorization header", Map.of()),
                arguments("Basic credentials", Map.of("Authorization", "Basic c3ludGhldGljOnN5bnRoZXRpYw==")),
                arguments("a Bearer value that is not a token", Map.of("Authorization", "Bearer guest-order-password-91c")),
                arguments("an empty Bearer value", Map.of("Authorization", "Bearer ")),
                arguments("an oversized Bearer value", Map.of("Authorization", "Bearer " + "a".repeat(8192))),
                arguments("a refresh cookie instead of a Bearer token", Map.of("Cookie", "MW_REFRESH=" + "A".repeat(43))));
    }

    @Test
    void anAccessTokenIsRejectedOnceItsUserIsDeleted() throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);
        assertThat(api.database().update("DELETE FROM users WHERE mobile = ?", user.mobile())).isOne();

        assertChallenged(api.profile(session.accessToken()));
    }

    @Test
    void anAccessTokenIsRejectedOnceItsUserCanNoLongerSignIn() throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);
        api.database().update("UPDATE users SET password_hash = 'not-an-argon2-verifier' WHERE mobile = ?",
                user.mobile());

        assertChallenged(api.profile(session.accessToken()));
    }

    /** A token placed anywhere but the Authorization header is ignored, so the request stays anonymous. */
    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {"access_token query parameter", "token query parameter", "X-Auth-Token header",
            "access_token cookie"})
    void aValidAccessTokenOutsideTheAuthorizationHeaderIsIgnored(String placement) throws Exception {
        String token = api.signIn(api.registered()).accessToken();

        var response = switch (placement) {
            case "access_token query parameter" -> api.send("GET", PROFILE + "?access_token=" + token, Map.of(), null);
            case "token query parameter" -> api.send("GET", PROFILE + "?token=" + token, Map.of(), null);
            case "X-Auth-Token header" -> api.send("GET", PROFILE, Map.of("X-Auth-Token", token), null);
            default -> api.send("GET", PROFILE, Map.of("Cookie", "access_token=" + token), null);
        };

        assertChallenged(response);
    }

    /** Tokens signed with the production key whose subject or session was changed alone. */
    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {"session of another user", "session that does not exist", "subject of another user"})
    void aValidlySignedTokenPairingAUserWithAnotherSessionIsRejected(String altered) throws Exception {
        User user = api.registered();
        api.signIn(user);
        User other = api.registered();
        api.signIn(other);
        UUID userId = altered.startsWith("subject") ? api.userId(other) : api.userId(user);
        UUID sessionId = switch (altered) {
            case "session of another user" -> api.sessionId(other);
            case "session that does not exist" -> UUID.randomUUID();
            default -> api.sessionId(user);
        };

        String token = api.track(api.app().bean(AccessTokenCodec.class).issue(userId, sessionId).token());

        assertChallenged(api.profile(token));
    }

    private static void assertChallenged(HttpResponse<String> response) {
        assertError(response, 401, "AUTHENTICATION_REQUIRED");
        assertThat(response.headers().allValues("WWW-Authenticate")).containsExactly("Bearer");
    }
}
