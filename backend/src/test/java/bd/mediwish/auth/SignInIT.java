package bd.mediwish.auth;

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

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;

@Tag("integration")
@Tag("security")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class SignInIT {
    private final AuthApi api;

    SignInIT(AuthApi api) {
        this.api = api;
    }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    /** Every accepted sign-in is also checked against the full session contract by {@link AuthApi#session}. */
    @ParameterizedTest(name = "{0}")
    @MethodSource
    void aUserSignsInByUsernameVerifiedMobileOrEmail(String identifier, Function<User, String> of) throws Exception {
        User user = api.registered();
        api.verifyMobile(user);

        var session = api.session(api.login(of.apply(user), user.password()));

        assertThat(session.user()).isEqualTo(user.profile(true));
        assertThat(api.sessions(user)).isOne();
    }

    static Stream<Arguments> aUserSignsInByUsernameVerifiedMobileOrEmail() {
        return Stream.of(
                arguments("username", (Function<User, String>) User::username),
                arguments("username in upper case with spaces",
                        (Function<User, String>) user -> " " + user.username().toUpperCase(Locale.ROOT) + " "),
                arguments("verified mobile", (Function<User, String>) User::mobile),
                arguments("verified mobile with spaces", (Function<User, String>) user -> " " + user.mobile() + " "),
                arguments("email", (Function<User, String>) User::email),
                arguments("email in upper case", (Function<User, String>) user -> user.email().toUpperCase(Locale.ROOT)));
    }

    @Test
    void aWrongPasswordAndAnUnknownIdentifierFailIdenticallyWithoutASession() throws Exception {
        User user = api.registered();

        assertRejected(api.login(user.username(), api.newUser().password()));
        assertRejected(api.login(api.newUser().username(), user.password()));
        assertThat(api.sessions(user)).isZero();
    }

    @Test
    void anUnverifiedMobileIsNotASignInIdentifier() throws Exception {
        User user = api.registered();

        assertRejected(api.login(user.mobile(), user.password()));
        assertThat(api.sessions(user)).isZero();
    }

    @Test
    void anIdentifierThatIsOneUsersUsernameAndAnothersVerifiedMobileSignsInNeither() throws Exception {
        User mobileOwner = api.registered();
        api.verifyMobile(mobileOwner);
        User usernameOwner = api.registered();
        legacyUsername(usernameOwner, mobileOwner.mobile());

        assertRejected(api.login(mobileOwner.mobile(), usernameOwner.password()));
        assertRejected(api.login(mobileOwner.mobile(), mobileOwner.password()));
        assertThat(api.sessions(usernameOwner) + api.sessions(mobileOwner)).isZero();
        api.session(api.login(usernameOwner.email(), usernameOwner.password()));
        api.session(api.login(mobileOwner.username(), mobileOwner.password()));
    }

    @Test
    void anIdentifierMatchingOneUserInTwoFieldsSignsIn() throws Exception {
        User user = api.registered();
        api.verifyMobile(user);
        legacyUsername(user, user.mobile());

        var session = api.session(api.login(user.mobile(), user.password()));

        assertThat(session.user()).containsEntry("username", user.mobile());
    }

    @Test
    void anEmailSharedIgnoringCaseByTwoUsersSignsInNeither() throws Exception {
        User first = api.registered();
        User other = api.newUser();
        User second = api.register(new User(other.username(), other.mobile(), first.email(), other.password()));
        // Registration lowercases email; an older row may still hold another case.
        api.database().update("UPDATE users SET email = upper(email) WHERE mobile = ?", second.mobile());

        assertRejected(api.login(first.email(), first.password()));
        assertRejected(api.login(first.email().toUpperCase(Locale.ROOT), second.password()));
        assertThat(api.sessions(first) + api.sessions(second)).isZero();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource
    void anInvalidSignInRequestIsRejected(String problem, String contentType, String body, int status)
            throws Exception {
        assertError(api.post("/api/auth/login", Map.of("Content-Type", contentType), body), status, "INVALID_REQUEST");
    }

    static Stream<Arguments> anInvalidSignInRequestIsRejected() {
        String json = "application/json";
        String login = """
                {"identifier":"%s","password":"%s"}""";
        return Stream.of(
                arguments("malformed JSON", json, "{\"identifier\":", 400),
                arguments("missing password", json, "{\"identifier\":\"someone_1\"}", 400),
                arguments("blank identifier", json, login.formatted(" ", "synthetic-password-value"), 400),
                arguments("identifier longer than 320 characters", json,
                        login.formatted("a".repeat(321), "synthetic-password-value"), 400),
                arguments("password longer than 128 characters", json, login.formatted("someone_1", "p".repeat(129)), 400),
                arguments("JSON body over 16 KiB", json, login.formatted("a".repeat(16 * 1024), "synthetic-password-value"), 400),
                arguments("plain-text body", "text/plain", login.formatted("someone_1", "synthetic-password-value"), 415));
    }

    /** The body limit matches the route as Spring MVC does, so a percent-encoded login path cannot skip it. */
    @Test
    void aJsonBodyOverTheLimitIsRejectedOnAPercentEncodedLoginPath() throws Exception {
        var headers = new HashMap<>(api.protectedHeaders());
        headers.put("Content-Type", "application/json");
        String paddedLogin = """
                {"identifier":"someone_1","password":"synthetic-password-value"}""" + " ".repeat(16 * 1024);

        assertError(api.post("/api/auth/%6Cogin", headers, paddedLogin), 400, "INVALID_REQUEST");
    }

    /** Each value is sent as the identifier and password and in the headers an order or payment flow would use. */
    @ParameterizedTest
    @ValueSource(strings = {"ORD-2026-000123", "payment-key-7f3a9c", "guest-order-password-91c", "01700000001"})
    void orderPaymentGuestAndRequestIdValuesCannotCreateASession(String value) throws Exception {
        long sessions = api.database().single("SELECT count(*) FROM user_sessions", Long.class);

        assertRejected(api.post("/api/auth/login", Map.of("Content-Type", "application/json",
                "X-Request-ID", value, "Idempotency-Key", value, "X-Order-Reference", value,
                "Cookie", "MW_REFRESH=" + "A".repeat(43)), """
                {"identifier":"%s","password":"%s"}""".formatted(value, value)));
        assertThat(api.database().single("SELECT count(*) FROM user_sessions", Long.class)).isEqualTo(sessions);
    }

    @Test
    void aDeliveryPersonSignsInAndReadsTheirProfile() throws Exception {
        User user = api.registered();
        api.database().update("UPDATE user_roles SET role = 'DELIVERY_PERSON' WHERE user_id = ?", api.userId(user));

        var profile = api.profile(api.signIn(user).accessToken());

        assertThat(profile.statusCode()).isEqualTo(200);
        assertThat(json(profile)).isEqualTo(user.profile(false));
    }

    /** Writes a username that predates the rule that usernames contain a letter. */
    private void legacyUsername(User user, String username) throws Exception {
        assertThat(api.database().update("UPDATE users SET username = ? WHERE mobile = ?", username, user.mobile()))
                .isOne();
    }

    private static void assertRejected(HttpResponse<String> response) {
        assertError(response, 401, "AUTHENTICATION_FAILED");
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
    }
}
