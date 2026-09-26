package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.Generation;
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
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Stream;

import static bd.mediwish.auth.AuthApi.ALLOWED_ORIGIN;
import static bd.mediwish.auth.AuthApi.assertRefreshCookieCleared;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;

/** Refresh, rotation, replay and logout through the production filter chain, including its CSRF and CORS checks. */
@Tag("integration")
@Tag("security")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class SessionIT {
    private static final String REFRESH = "/api/auth/refresh";
    private static final String LOGOUT = "/api/auth/logout";
    private static final String DISALLOWED_ORIGIN = "https://evil.example.test";

    private final AuthApi api;

    SessionIT(AuthApi api) {
        this.api = api;
    }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void refreshRotatesBothTokensAndConsumesThePresentedGeneration() throws Exception {
        User user = api.registered();
        Session initial = api.signIn(user);

        Session rotated = api.session(api.refresh(initial.refreshToken()));

        assertThat(rotated.accessToken()).isNotEqualTo(initial.accessToken());
        assertThat(rotated.refreshToken()).isNotEqualTo(initial.refreshToken());
        assertThat(rotated.user()).isEqualTo(user.profile(false));
        assertThat(api.generations(user)).containsExactly(new Generation(0, true), new Generation(1, false));
        assertThat(api.profile(rotated.accessToken()).statusCode()).isEqualTo(200);
    }

    @Test
    void refreshWithoutARefreshCookieIsQuietlySignedOut() throws Exception {
        var response = api.refresh();

        assertThat(response.statusCode()).isEqualTo(204);
        assertThat(response.body()).isEmpty();
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
    }

    @Test
    void refreshWithoutARefreshCookieOrACsrfTokenIsDenied() throws Exception {
        var response = api.post(REFRESH, Map.of("Origin", ALLOWED_ORIGIN), null);

        assertError(response, 403, "ACCESS_DENIED");
        assertThat(response.headers().allValues("Set-Cookie")).noneMatch(cookie -> cookie.startsWith("MW_REFRESH="));
    }

    @Test
    void refreshWithoutAnOriginHeaderIsAcceptedWithAValidCsrfToken() throws Exception {
        Session session = api.signIn(api.registered());
        var headers = new HashMap<>(api.protectedHeaders(session.refreshToken()));
        headers.remove("Origin");

        api.session(api.post(REFRESH, headers, null));
    }

    /** A1: every refresh cookie that is sent but unusable gets the one generic 401 and is cleared. */
    @ParameterizedTest(name = "{0}")
    @MethodSource
    void aRejectedRefreshCookieIsClearedWithoutConsumingTheSession(String cookie, Function<String, String[]> sent)
            throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);

        var response = api.refresh(sent.apply(session.refreshToken()));

        assertError(response, 401, "AUTHENTICATION_REQUIRED");
        assertRefreshCookieCleared(response);
        assertThat(api.generations(user)).containsExactly(new Generation(0, false));
        api.session(api.refresh(session.refreshToken()));
    }

    static Stream<Arguments> aRejectedRefreshCookieIsClearedWithoutConsumingTheSession() {
        return Stream.of(
                arguments("empty", (Function<String, String[]>) valid -> new String[]{""}),
                arguments("longer than 4096 characters",
                        (Function<String, String[]>) valid -> new String[]{"a".repeat(4097)}),
                arguments("well-formed but never issued",
                        (Function<String, String[]>) valid -> new String[]{"A".repeat(43)}),
                arguments("one character altered", (Function<String, String[]>) valid -> new String[]{altered(valid)}),
                arguments("truncated",
                        (Function<String, String[]>) valid -> new String[]{valid.substring(0, valid.length() / 2)}),
                arguments("the valid value sent twice", (Function<String, String[]>) valid -> new String[]{valid, valid}),
                arguments("the valid value and another",
                        (Function<String, String[]>) valid -> new String[]{valid, altered(valid)}));
    }

    /** Also covers a retry after a lost refresh response, which the server cannot tell from a replay. */
    @Test
    void replayingAConsumedRefreshCookieRevokesTheWholeSession() throws Exception {
        User user = api.registered();
        Session initial = api.signIn(user);
        Session rotated = api.session(api.refresh(initial.refreshToken()));

        var replay = api.refresh(initial.refreshToken());

        assertError(replay, 401, "AUTHENTICATION_REQUIRED");
        assertRefreshCookieCleared(replay);
        assertThat(api.generations(user)).containsExactly(new Generation(0, true), new Generation(1, false));
        assertThat(api.revoked(user, RevocationReason.REFRESH_REPLAY)).isOne();
        assertError(api.profile(rotated.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(rotated.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    @Test
    void anExpiredSessionRejectsItsAccessAndRefreshTokens() throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);
        assertThat(api.database().update("UPDATE user_sessions SET expires_at = now() - interval '1 day' WHERE id = ?",
                api.sessionId(user))).isOne();

        assertError(api.profile(session.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        var refresh = api.refresh(session.refreshToken());
        assertError(refresh, 401, "AUTHENTICATION_REQUIRED");
        assertRefreshCookieCleared(refresh);
    }

    @Test
    void refreshForAUserWhoCanNoLongerSignInIsRejectedAndRevokesTheSession() throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);
        api.database().update("UPDATE users SET password_hash = 'not-an-argon2-verifier' WHERE mobile = ?",
                user.mobile());

        var refresh = api.refresh(session.refreshToken());

        assertError(refresh, 401, "AUTHENTICATION_REQUIRED");
        assertRefreshCookieCleared(refresh);
        assertThat(api.revoked(user, RevocationReason.USER_UNAVAILABLE)).isOne();
    }

    @Test
    void aRotationThatFailsAtCommitLeavesThePresentedCookieUsable() throws Exception {
        User user = api.registered();
        Session initial = api.signIn(user);

        HttpResponse<String> failed;
        try (var failure = api.failCommitsWhere("user_session_refresh_tokens", "INSERT",
                "NEW.session_id = '" + api.sessionId(user) + "'::uuid")) {
            failed = api.refresh(initial.refreshToken());
        }

        assertError(failed, 500, "INTERNAL_ERROR");
        assertThat(failed.headers().allValues("Set-Cookie")).isEmpty();
        assertThat(api.generations(user)).containsExactly(new Generation(0, false));
        api.session(api.refresh(initial.refreshToken()));
        assertThat(api.generations(user)).containsExactly(new Generation(0, true), new Generation(1, false));
    }

    @Test
    void logoutRevokesTheSessionAndClearsTheCookieEachTimeItIsRepeated() throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);

        for (int attempt = 0; attempt < 2; attempt++) {
            var logout = api.logout(session.refreshToken());
            assertThat(logout.statusCode()).isEqualTo(204);
            assertRefreshCookieCleared(logout);
        }

        assertThat(api.sessions(user)).isOne();
        assertThat(api.revoked(user, RevocationReason.LOGOUT)).isOne();
        assertThat(api.generations(user)).containsExactly(new Generation(0, false));
        assertError(api.profile(session.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(session.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    @Test
    void logoutWithoutARefreshCookieStillClearsIt() throws Exception {
        var logout = api.logout();

        assertThat(logout.statusCode()).isEqualTo(204);
        assertRefreshCookieCleared(logout);
    }

    @Test
    void logoutRevokesEverySessionThatDuplicatedCookiesName() throws Exception {
        User user = api.registered();
        Session first = api.signIn(user);
        Session second = api.signIn(user);

        assertThat(api.logout(first.refreshToken(), second.refreshToken()).statusCode()).isEqualTo(204);

        assertThat(api.revoked(user, RevocationReason.LOGOUT)).isEqualTo(2);
        assertError(api.profile(first.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.profile(second.accessToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    /** The commit fails only once both revocations are visible; committing each one alone would revoke the first. */
    @Test
    void aLogoutThatFailsAtCommitKeepsEverySessionActiveAndCanBeRetried() throws Exception {
        User user = api.registered();
        Session first = api.signIn(user);
        Session second = api.signIn(user);

        HttpResponse<String> failed;
        try (var failure = api.failCommitsWhere("user_sessions", "UPDATE",
                "NEW.revoked_at IS NOT NULL AND (SELECT count(*) FROM user_sessions WHERE user_id = NEW.user_id "
                        + "AND revoked_at IS NOT NULL) > 1")) {
            failed = api.logout(first.refreshToken(), second.refreshToken());
        }

        assertError(failed, 500, "INTERNAL_ERROR");
        assertThat(api.revoked(user, RevocationReason.LOGOUT)).isZero();
        assertThat(api.profile(first.accessToken()).statusCode()).isEqualTo(200);
        assertThat(api.profile(second.accessToken()).statusCode()).isEqualTo(200);
        assertThat(api.logout(first.refreshToken(), second.refreshToken()).statusCode()).isEqualTo(204);
        assertThat(api.revoked(user, RevocationReason.LOGOUT)).isEqualTo(2);
    }

    @Test
    void revokingEverySessionOfAUserRejectsAllTheirTokens() throws Exception {
        User user = api.registered();
        Session first = api.signIn(user);
        Session second = api.signIn(user);

        api.app().bean(SessionService.class).revokeAllForUser(api.userId(user), RevocationReason.LOGOUT);

        assertThat(api.revoked(user, RevocationReason.LOGOUT)).isEqualTo(2);
        for (Session session : new Session[]{first, second}) {
            assertError(api.profile(session.accessToken()), 401, "AUTHENTICATION_REQUIRED");
            assertError(api.refresh(session.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        }
    }

    @ParameterizedTest(name = "{0} {1}")
    @MethodSource
    void aMissingOrMismatchedCsrfTokenIsDeniedAndChangesNothing(String route, String problem,
                                                                 Function<Map<String, String>, Map<String, String>> tamper)
            throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);

        var response = api.post(route, tamper.apply(new HashMap<>(api.protectedHeaders(session.refreshToken()))), null);

        assertError(response, 403, "ACCESS_DENIED");
        assertUnchanged(user, session, response);
    }

    static Stream<Arguments> aMissingOrMismatchedCsrfTokenIsDeniedAndChangesNothing() {
        Function<Map<String, String>, Map<String, String>> noHeader = headers -> {
            headers.remove("X-XSRF-TOKEN");
            return headers;
        };
        Function<Map<String, String>, Map<String, String>> wrongHeader = headers -> {
            headers.put("X-XSRF-TOKEN", "a-different-csrf-value");
            return headers;
        };
        Function<Map<String, String>, Map<String, String>> noCookie = headers -> {
            headers.put("Cookie", headers.get("Cookie").replaceAll("; XSRF-TOKEN=[^;]*", ""));
            return headers;
        };
        return Stream.of(REFRESH, LOGOUT).flatMap(route -> Stream.of(
                arguments(route, "without the CSRF header", noHeader),
                arguments(route, "with a CSRF header that differs from the cookie", wrongHeader),
                arguments(route, "without the CSRF cookie", noCookie)));
    }

    @ParameterizedTest
    @ValueSource(strings = {REFRESH, LOGOUT})
    void aDisallowedOriginIsDeniedAndChangesNothing(String route) throws Exception {
        User user = api.registered();
        Session session = api.signIn(user);
        var headers = new HashMap<>(api.protectedHeaders(session.refreshToken()));
        headers.put("Origin", DISALLOWED_ORIGIN);

        var response = api.post(route, headers, null);

        assertError(response, 403, "ACCESS_DENIED");
        assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).isEmpty();
        assertUnchanged(user, session, response);
    }

    @Test
    void anAllowedOriginsPreflightPermitsCredentialsAndTheCsrfHeader() throws Exception {
        var response = api.send("OPTIONS", REFRESH, Map.of("Origin", ALLOWED_ORIGIN,
                "Access-Control-Request-Method", "POST",
                "Access-Control-Request-Headers", "content-type,x-xsrf-token"), null);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).hasValue(ALLOWED_ORIGIN);
        assertThat(response.headers().firstValue("Access-Control-Allow-Credentials")).hasValue("true");
        assertThat(response.headers().firstValue("Access-Control-Allow-Methods").orElseThrow()).contains("POST");
        assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElseThrow()
                .toLowerCase(Locale.ROOT)).contains("content-type", "x-xsrf-token");
    }

    /** The denied request neither rotated, revoked nor cleared anything: the session still works. */
    private void assertUnchanged(User user, Session session, HttpResponse<String> response) throws Exception {
        assertThat(response.headers().allValues("Set-Cookie")).noneMatch(cookie -> cookie.startsWith("MW_REFRESH="));
        assertThat(api.generations(user)).containsExactly(new Generation(0, false));
        assertThat(api.profile(session.accessToken()).statusCode()).isEqualTo(200);
    }

    private static String altered(String value) {
        return (value.charAt(0) == 'A' ? "B" : "A") + value.substring(1);
    }
}
