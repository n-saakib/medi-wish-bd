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
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

import static bd.mediwish.auth.AuthApi.JSON_CONTENT;
import static bd.mediwish.auth.AuthApi.registration;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;

@Tag("integration")
@Tag("contract")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class RegistrationIT {
    private static final String REGISTER = "/api/auth/register";

    private final AuthApi api;

    RegistrationIT(AuthApi api) {
        this.api = api;
    }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void registrationStoresTheNormalizedUserWithAnArgon2idVerifierAndOnlyTheCustomerRole() throws Exception {
        User user = api.newUser();
        var response = api.post(REGISTER, JSON_CONTENT, """
                {"username":" %s ","mobile":" %s ","email":" %s ","password":"%s"}
                """.formatted(user.username().toUpperCase(Locale.ROOT), user.mobile(),
                user.email().toUpperCase(Locale.ROOT), user.password()));

        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(json(response)).isEqualTo(Map.of("username", user.username(), "mobile", user.mobile(),
                "email", user.email(), "mobileVerificationDeferred", true));
        assertThat(api.database().single("SELECT mobile_verified FROM users WHERE mobile = ?", Boolean.class,
                user.mobile())).isFalse();
        String verifier = api.track(api.database().single(
                "SELECT password_hash FROM users WHERE mobile = ?", String.class, user.mobile()));
        assertThat(verifier.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).as("the stored verifier format").isTrue();
        assertThat(verifier.contains(user.password())).as("the verifier contains the password").isFalse();
        assertThat(roles(user)).containsExactly("CUSTOMER");
    }

    @Test
    void callerSuppliedRolesAreIgnored() throws Exception {
        User user = api.newUser();
        var response = api.post(REGISTER, JSON_CONTENT, registration(user)
                .replaceFirst("\\{", "{\"role\":\"ADMIN\",\"roles\":[\"ADMIN\",\"DELIVERY_PERSON\"],"));

        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(roles(user)).containsExactly("CUSTOMER");
    }

    @Test
    void usersRegisteredWithoutAnEmailSignIn() throws Exception {
        User first = api.register(api.newUserWithoutEmail());
        User second = api.register(api.newUserWithoutEmail());

        assertThat(api.signIn(first).user()).isEqualTo(first.profile(false));
        assertThat(api.signIn(second).user()).isEqualTo(second.profile(false));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource
    void invalidRegistrationIsRejectedWithoutCreatingAUser(String rule, String body) throws Exception {
        long users = userCount();

        assertError(api.post(REGISTER, JSON_CONTENT, body), 400, "INVALID_REQUEST");
        assertThat(userCount()).isEqualTo(users);
    }

    static Stream<Arguments> invalidRegistrationIsRejectedWithoutCreatingAUser() {
        String valid = """
                {"username":"%s","mobile":"01700000000","email":"%s","password":"%s"}""";
        String password = "synthetic-registration";
        return Stream.of(
                arguments("username shorter than three characters", valid.formatted("ab", "a@example.test", password)),
                arguments("username longer than 50 characters",
                        valid.formatted("a".repeat(51), "a@example.test", password)),
                arguments("username with a space and punctuation",
                        valid.formatted("bad name!", "a@example.test", password)),
                arguments("username without a letter", valid.formatted("01712345678", "a@example.test", password)),
                arguments("email without an at sign", valid.formatted("valid_name", "not-an-email", password)),
                arguments("password shorter than 6 characters",
                        valid.formatted("valid_name", "a@example.test", "p".repeat(5))),
                arguments("password longer than 30 characters",
                        valid.formatted("valid_name", "a@example.test", "p".repeat(31))),
                arguments("missing mobile", """
                        {"username":"valid_name","password":"%s"}""".formatted(password)),
                arguments("malformed JSON", "{\"username\":"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"username", "mobile", "email"})
    void aTakenUsernameMobileOrEmailIsRejectedAsADuplicate(String taken) throws Exception {
        User owner = api.registered();
        User other = api.newUser();
        User clash = switch (taken) {
            case "username" -> new User(owner.username().toUpperCase(Locale.ROOT), other.mobile(), other.email(),
                    other.password());
            case "mobile" -> new User(other.username(), owner.mobile(), other.email(), other.password());
            default -> new User(other.username(), other.mobile(), owner.email().toUpperCase(Locale.ROOT),
                    other.password());
        };

        long users = userCount();

        assertError(api.post(REGISTER, JSON_CONTENT, registration(clash)), 409, "DUPLICATE_USER");
        assertThat(userCount()).isEqualTo(users);
        assertThat(api.session(api.login(owner.email(), owner.password())).user()).isEqualTo(owner.profile(false));
    }

    @Test
    void racingRegistrationsOfOneMobileCreateOneUser() throws Exception {
        User first = api.newUser();
        User second = api.newUser();

        race(first, new User(second.username(), first.mobile(), second.email(), second.password()));

        assertThat(api.database().single("SELECT count(*) FROM users WHERE mobile = ?", Long.class, first.mobile()))
                .isOne();
    }

    @Test
    void racingRegistrationsOfOneNormalizedUsernameCreateOneUser() throws Exception {
        User first = api.newUser();
        User second = api.newUser();

        race(first, new User(" " + first.username().toUpperCase(Locale.ROOT) + " ", second.mobile(),
                second.email(), second.password()));

        assertThat(api.database().single("SELECT count(*) FROM users WHERE username = ?", Long.class,
                first.username())).isOne();
    }

    @Test
    void racingRegistrationsOfOneEmailIgnoringCaseCreateOneUser() throws Exception {
        User first = api.newUser();
        User second = api.newUser();

        race(first, new User(second.username(), second.mobile(), first.email().toUpperCase(Locale.ROOT),
                second.password()));

        assertThat(api.database().single("SELECT count(*) FROM users WHERE email = ?", Long.class, first.email()))
                .isOne();
    }

    /** Releases both registrations at once; whichever commits first wins and the other is a duplicate. */
    private void race(User first, User second) throws Exception {
        var responses = AuthApi.race(() -> api.post(REGISTER, JSON_CONTENT, registration(first)),
                () -> api.post(REGISTER, JSON_CONTENT, registration(second)));
        assertThat(responses).extracting(HttpResponse::statusCode).containsExactlyInAnyOrder(201, 409);
        assertError(responses.stream().filter(response -> response.statusCode() == 409).findFirst().orElseThrow(),
                409, "DUPLICATE_USER");
    }

    private List<String> roles(User user) throws Exception {
        return api.database().query("SELECT role FROM user_roles WHERE user_id = ?", row -> row.getString(1),
                api.userId(user));
    }

    private long userCount() throws Exception {
        return api.database().single("SELECT count(*) FROM users", Long.class);
    }
}
