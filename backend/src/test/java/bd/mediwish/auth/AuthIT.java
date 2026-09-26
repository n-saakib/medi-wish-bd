package bd.mediwish.auth;

import bd.mediwish.MediWishApplication;
import bd.mediwish.health.TestDatabase;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.Socket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Tag("integration")
@Tag("regression")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthIT {
    private static final String ALLOWED_ORIGIN = "http://127.0.0.1:3000";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private HttpClient client;
    private TestDatabase database;
    private ConfigurableApplicationContext application;
    private URI base;
    private CurrentUserAuthentication currentUsers;
    private AuthenticationService authentication;

    @BeforeAll
    void startAgainstIsolatedPostgresSchema() throws Exception {
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
        database = TestDatabase.create();
        var properties = new HashMap<>(database.applicationProperties());
        properties.put("spring.profiles.active", "test");
        properties.put("app.cors.allowed-origins", ALLOWED_ORIGIN);
        properties.put("app.auth.access-token-lifetime", "PT5M");
        var launcher = new SpringApplication(MediWishApplication.class);
        launcher.setAdditionalProfiles("test");
        launcher.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("isolated-auth-integration", properties)));
        application = launcher.run();
        base = URI.create("http://127.0.0.1:"
                + application.getEnvironment().getRequiredProperty("local.server.port"));
        currentUsers = application.getBean(CurrentUserAuthentication.class);
        authentication = application.getBean(AuthenticationService.class);
    }

    @AfterAll
    void closeOnlyResourcesOwnedByThisRun() throws Exception {
        try {
            if (application != null) application.close();
        } finally {
            try {
                if (database != null) database.close();
            } finally {
                if (client != null) client.close();
            }
        }
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void authenticationCredentialsAndSessionTokensAreAbsentFromCapturedApplicationOutput(CapturedOutput output)
            throws Exception {
        Credentials user = uniqueUser("log-redaction");
        register(user);
        String persistedVerifier = passwordVerifier(user);
        markMobileVerified(user);
        SessionPayload signedIn = login(user.username(), user, "log-redaction", true);
        ReceivedCookie csrf = csrfCookie();
        String wrongPassword = "synthetic-wrong-" + UUID.randomUUID().toString().replace("-", "");

        var failedSignIn = send("POST", "/api/auth/login", loginJson(user.username(), wrongPassword),
                requestId("log-redaction-failed"), null, Map.of());
        assertPrivateError(failedSignIn, 401, "AUTHENTICATION_FAILED", user.username(), user.mobile(),
                user.email(), user.password(), wrongPassword, signedIn.accessToken(),
                signedIn.refreshCookie().value(), csrf.value());

        var rotatedResponse = refresh(signedIn.refreshCookie().value(), csrf.value(), csrf.value(),
                requestId("log-redaction-refresh"));
        SessionPayload rotated = session(rotatedResponse);
        assertThat(rotatedResponse.body()).doesNotContain(user.password(), persistedVerifier,
                signedIn.refreshCookie().value(), csrf.value(), rotated.refreshCookie().value());
        assertThat(rotatedResponse.headers().map().toString()).doesNotContain(user.password(), user.mobile(),
                user.email(), signedIn.accessToken(), signedIn.refreshCookie().value(), csrf.value());

        var loggedOut = logout(rotated.refreshCookie().value(), csrf.value(), requestId("log-redaction-logout"));
        assertThat(loggedOut.statusCode()).isEqualTo(204);
        assertNoSensitiveResponseValues(loggedOut, user.username(), user.mobile(), user.email(), user.password(),
                wrongPassword, signedIn.accessToken(), signedIn.refreshCookie().value(), rotated.accessToken(),
                rotated.refreshCookie().value(), csrf.value());

        assertCapturedOutputOmits(output, user.username(), user.mobile(), user.email(), user.password(),
                wrongPassword, signedIn.accessToken(), signedIn.refreshCookie().value(), csrf.value(),
                rotated.accessToken(), rotated.refreshCookie().value(), persistedVerifier);
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void callerSuppliedPhoneShapedRequestIdDoesNotReachStructuredOutput(CapturedOutput output) throws Exception {
        String phoneShapedRequestId = "01700000001";
        var response = send("GET", "/api/user/me", null, phoneShapedRequestId, null, Map.of());

        assertThat(response.statusCode()).isEqualTo(401);
        String responseRequestId = response.headers().firstValue("X-Request-ID").orElseThrow();
        Map<?, ?> error = json(response);
        assertThat(error.get("requestId")).isEqualTo(responseRequestId);
        assertThat(responseRequestId.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
                .as("response correlation is server-generated")
                .isTrue();
        assertThat(responseRequestId.equals(phoneShapedRequestId))
                .as("caller-controlled phone-shaped values are not reflected")
                .isFalse();
        String responseLogMarker = "\"requestId\":\"" + responseRequestId + "\"";
        String ecsLine = org.awaitility.Awaitility.await()
                .atMost(Duration.ofSeconds(2))
                .until(() -> output.getAll().lines()
                                .filter(line -> line.contains("\"logger\":\"bd.mediwish.web.RequestCorrelationFilter\""))
                                .filter(line -> line.contains("\"message\":\"HTTP response status=401\""))
                                .filter(line -> line.contains(responseLogMarker))
                                .findFirst().orElse(null),
                        line -> line != null);
        String loggedRequestId = String.valueOf(JSON.readValue(ecsLine, Map.class).get("requestId"));
        assertThat(loggedRequestId).isEqualTo(responseRequestId);
        assertThat((response.body() + response.headers().map()).contains(phoneShapedRequestId))
                .as("HTTP output must omit caller-controlled phone-shaped request IDs").isFalse();
        assertThat(output.getAll().contains(phoneShapedRequestId))
                .as("captured ECS output must omit caller-controlled phone-shaped request IDs").isFalse();
    }

    @Test
    void loginAcceptsUsernameVerifiedMobileAndEmailWithSafeBearerProfile() throws Exception {
        Credentials user = uniqueUser("identifier");
        register(user);
        markMobileVerified(user);

        SessionPayload byUsername = login(user.username(), user, "username", true);
        SessionPayload byMobile = login(user.mobile(), user, "mobile", true);
        SessionPayload byEmail = login(user.email(), user, "email", true);
        assertThat(!byUsername.accessToken().equals(byMobile.accessToken())).isTrue();
        assertThat(!byMobile.accessToken().equals(byEmail.accessToken())).isTrue();

        var profile = send("GET", "/api/user/me", null, requestId("profile"),
                "Bearer " + byUsername.accessToken(), Map.of());
        assertProfile(profile, user, true);

        var basic = send("GET", "/api/user/me", null, requestId("basic"),
                "Basic " + Base64.getEncoder().encodeToString(
                        "synthetic:synthetic".getBytes(StandardCharsets.UTF_8)), Map.of());
        assertPrivateError(basic, 401, "AUTHENTICATION_REQUIRED", "synthetic:synthetic",
                user.username(), user.mobile(), user.email());
        assertThat(basic.headers().firstValue("WWW-Authenticate")).contains("Bearer");

        var wrongPassword = send("POST", "/api/auth/login",
                loginJson(user.username(), "wrong-password-value"),
                requestId("wrong"), null, Map.of());
        String unknownValue = "missing_" + UUID.randomUUID().toString().replace("-", "");
        var unknownIdentifier = send("POST", "/api/auth/login",
                loginJson(unknownValue,
                        "wrong-" + UUID.randomUUID().toString().replace("-", "")),
                requestId("unknown"), null, Map.of());
        Map<?, ?> wrongBody = assertPrivateError(wrongPassword, 401, "AUTHENTICATION_FAILED",
                user.username(), user.mobile(), user.email(), "wrong-password-value");
        Map<?, ?> unknownBody = assertPrivateError(unknownIdentifier, 401, "AUTHENTICATION_FAILED",
                unknownValue);
        assertThat(wrongBody.get("message")).isEqualTo(unknownBody.get("message"));
    }

    @Test
    void rejectsUnverifiedMobileAndCrossFieldIdentifierCollisionsGenerically() throws Exception {
        Credentials unverified = uniqueUser("unverified-mobile");
        register(unverified);

        var unverifiedMobile = send("POST", "/api/auth/login",
                loginJson(unverified.mobile(), unverified.password()), requestId("unverified-mobile"), null, Map.of());
        assertPrivateError(unverifiedMobile, 401, "AUTHENTICATION_FAILED",
                unverified.mobile(), unverified.password());

        Credentials usernameOwner = uniqueUser("collide");
        register(usernameOwner);
        Credentials mobileOwner = new Credentials(
                uniqueUser("collision-mobile").username(),
                usernameOwner.username(),
                "collision." + UUID.randomUUID().toString().replace("-", "").substring(0, 12) + "@example.test",
                "synthetic-collision-password");
        register(mobileOwner);
        markMobileVerified(mobileOwner);

        var collision = send("POST", "/api/auth/login",
                loginJson(usernameOwner.username(), mobileOwner.password()),
                requestId("identifier-collision"), null, Map.of());
        assertPrivateError(collision, 401, "AUTHENTICATION_FAILED", usernameOwner.username(),
                usernameOwner.password(), mobileOwner.password());
    }

    @Test
    void rejectsAmbiguousOptionalEmailGenericallyWithoutCreatingSession() throws Exception {
        Credentials first = uniqueUser("ambiguous-email-first");
        Credentials second = uniqueUser("ambiguous-email-second");
        Credentials third = uniqueUser("ambiguous-email-third");
        String sharedEmail = "ambiguous." + UUID.randomUUID().toString().replace("-", "").substring(0, 16)
                + "@example.test";
        first = new Credentials(first.username(), first.mobile(), sharedEmail, first.password());
        second = new Credentials(second.username(), second.mobile(), sharedEmail, second.password());
        third = new Credentials(third.username(), third.mobile(), sharedEmail, third.password());
        register(first);
        register(second);
        register(third);

        assertThat(application.getBean(UserRepository.class).findTop2ByEmailIgnoreCase(sharedEmail)).hasSize(2);
        assertEmailLookupIndexesAreNonUnique();

        var firstPasswordAttempt = send("POST", "/api/auth/login",
                loginJson(sharedEmail, first.password()), requestId("ambiguous-email-first"), null, Map.of());
        var secondPasswordAttempt = send("POST", "/api/auth/login",
                loginJson(sharedEmail, second.password()), requestId("ambiguous-email-second"), null, Map.of());
        var wrongPasswordAttempt = send("POST", "/api/auth/login",
                loginJson(first.username(), "synthetic-wrong-password"), requestId("ambiguous-email-wrong"),
                null, Map.of());

        Map<?, ?> firstFailure = assertPrivateError(firstPasswordAttempt, 401, "AUTHENTICATION_FAILED",
                sharedEmail, first.password(), second.password());
        Map<?, ?> secondFailure = assertPrivateError(secondPasswordAttempt, 401, "AUTHENTICATION_FAILED",
                sharedEmail, first.password(), second.password(), third.password());
        Map<?, ?> wrongPasswordFailure = assertPrivateError(wrongPasswordAttempt, 401, "AUTHENTICATION_FAILED",
                first.username(), "synthetic-wrong-password");
        assertThat(firstFailure.get("message")).isEqualTo(wrongPasswordFailure.get("message"));
        assertThat(secondFailure.get("message")).isEqualTo(wrongPasswordFailure.get("message"));
        assertThat(firstPasswordAttempt.headers().allValues("Set-Cookie")).isEmpty();
        assertThat(secondPasswordAttempt.headers().allValues("Set-Cookie")).isEmpty();
        assertThat(countSessions(first)).isZero();
        assertThat(countSessions(second)).isZero();
        assertThat(countSessions(third)).isZero();
    }

    @Test
    void rejectsCaseOnlyOptionalEmailDuplicatesGenericallyWithoutCreatingSession() throws Exception {
        Credentials first = uniqueUser("case-email-first");
        Credentials second = uniqueUser("case-email-second");
        String sharedEmail = "case." + UUID.randomUUID().toString().replace("-", "").substring(0, 16)
                + "@example.test";
        first = new Credentials(first.username(), first.mobile(), sharedEmail, first.password());
        second = new Credentials(second.username(), second.mobile(), sharedEmail, second.password());
        register(first);
        register(second);

        String mixedCaseEmail = sharedEmail.toUpperCase(Locale.ROOT);
        storeLegacyEmailCase(second, mixedCaseEmail);
        var users = application.getBean(UserRepository.class);
        assertThat(users.findTop2ByEmailIgnoreCase(sharedEmail)).hasSize(2);
        assertThat(users.findByUsername(second.username()).orElseThrow().email()).isEqualTo(mixedCaseEmail);

        var lowercaseAttempt = send("POST", "/api/auth/login",
                loginJson(sharedEmail, first.password()), requestId("case-email-lower"), null, Map.of());
        var mixedCaseAttempt = send("POST", "/api/auth/login",
                loginJson(mixedCaseEmail, second.password()), requestId("case-email-mixed"), null, Map.of());
        var wrongPasswordAttempt = send("POST", "/api/auth/login",
                loginJson(first.username(), "synthetic-case-email-wrong-password"),
                requestId("case-email-wrong"), null, Map.of());

        Map<?, ?> lowercaseFailure = assertPrivateError(lowercaseAttempt, 401, "AUTHENTICATION_FAILED",
                sharedEmail, first.password(), second.password());
        Map<?, ?> mixedCaseFailure = assertPrivateError(mixedCaseAttempt, 401, "AUTHENTICATION_FAILED",
                mixedCaseEmail, first.password(), second.password());
        Map<?, ?> wrongPasswordFailure = assertPrivateError(wrongPasswordAttempt, 401, "AUTHENTICATION_FAILED",
                first.username(), "synthetic-case-email-wrong-password");
        assertThat(lowercaseFailure.get("message")).isEqualTo(wrongPasswordFailure.get("message"));
        assertThat(mixedCaseFailure.get("message")).isEqualTo(wrongPasswordFailure.get("message"));
        assertThat(lowercaseAttempt.headers().allValues("Set-Cookie")).isEmpty();
        assertThat(mixedCaseAttempt.headers().allValues("Set-Cookie")).isEmpty();
        assertThat(countSessions(first)).isZero();
        assertThat(countSessions(second)).isZero();
    }

    @Test
    void orderPaymentAndGuestCredentialsCannotCreateUserSessions() throws Exception {
        String suffix = UUID.randomUUID().toString().replace("-", "");
        String orderReference = "synthetic-order-" + suffix;
        String paymentIdempotencyKey = "synthetic-payment-" + suffix;
        String guestCredential = "synthetic-guest-" + suffix;
        String requestIdCredential = "01700000001";
        String randomRefreshCookie = UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", "").substring(0, 11);
        assertThat(randomRefreshCookie).matches("[A-Za-z0-9_-]{43}");
        ReceivedCookie csrf = csrfCookie();
        long sessionCountBefore = countAllSessions();
        Map<String, String> unrelatedRequestContext = Map.of(
                "Cookie", "MW_REFRESH=" + randomRefreshCookie,
                "Idempotency-Key", paymentIdempotencyKey,
                "X-Order-Reference", orderReference);

        var orderLogin = send("POST", "/api/auth/login", loginJson(orderReference, guestCredential),
                requestId("order-reference-login"), null, unrelatedRequestContext);
        var paymentLogin = send("POST", "/api/auth/login", loginJson(paymentIdempotencyKey, guestCredential),
                requestId("payment-key-login"), null, unrelatedRequestContext);
        var guestLogin = send("POST", "/api/auth/login", loginJson(guestCredential, guestCredential),
                requestId("guest-credential-login"), null, unrelatedRequestContext);
        var requestIdLogin = send("POST", "/api/auth/login", loginJson(requestIdCredential, guestCredential),
                requestIdCredential, null, unrelatedRequestContext);

        for (var response : Arrays.asList(orderLogin, paymentLogin, guestLogin, requestIdLogin)) {
            assertPrivateError(response, 401, "AUTHENTICATION_FAILED", orderReference,
                    paymentIdempotencyKey, guestCredential, requestIdCredential, randomRefreshCookie);
            assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
        }

        var randomCookieRefresh = refresh(randomRefreshCookie, csrf.value(), csrf.value(),
                requestId("random-cookie-refresh"));
        assertPrivateError(randomCookieRefresh, 401, "AUTHENTICATION_REQUIRED", orderReference,
                paymentIdempotencyKey, guestCredential, requestIdCredential, randomRefreshCookie);
        assertThat(randomCookieRefresh.headers().allValues("Set-Cookie"))
                .noneMatch(value -> value.startsWith("MW_REFRESH="));

        var guestProfile = send("GET", "/api/user/me", null, requestId("guest-profile"),
                "Bearer " + guestCredential, unrelatedRequestContext);
        assertPrivateError(guestProfile, 401, "AUTHENTICATION_REQUIRED", orderReference,
                paymentIdempotencyKey, guestCredential, requestIdCredential, randomRefreshCookie);
        assertThat(guestProfile.headers().allValues("Set-Cookie")).isEmpty();
        assertThat(countAllSessions()).isEqualTo(sessionCountBefore);
    }

    @Test
    void deliveryPersonCanCreatePasswordSessionThroughTheExistingRoleSeam() throws Exception {
        Credentials deliveryPerson = uniqueUser("delivery-person");
        register(deliveryPerson);
        assignRole(userId(deliveryPerson), UserRole.DELIVERY_PERSON);

        SessionPayload session = login(deliveryPerson.username(), deliveryPerson, "delivery-person", false);

        assertThat(currentUsers.authenticate(session.accessToken()).roles())
                .containsExactly(UserRole.DELIVERY_PERSON);
        var profile = send("GET", "/api/user/me", null, requestId("delivery-person-profile"),
                "Bearer " + session.accessToken(), Map.of());
        assertProfile(profile, deliveryPerson, false);
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void bearerIdentityLookupDatabaseFailureUsesBoundedCorrelatedErrorEnvelope(CapturedOutput output)
            throws Exception {
        Credentials user = uniqueUser("profile-database-error");
        register(user);
        SessionPayload session = login(user.username(), user, "profile-database-error", false);
        String callerRequestId = requestId("profile-database-error");
        String quarantinedTable = "ticket03_users_error_probe";
        boolean tableRenamed = false;
        HttpResponse<String> response;
        try {
            try (var connection = database.connect(); var statement = connection.createStatement()) {
                statement.execute("ALTER TABLE " + table("users") + " RENAME TO \"" + quarantinedTable + "\"");
            }
            tableRenamed = true;
            response = send("GET", "/api/user/me", null, callerRequestId,
                    "Bearer " + session.accessToken(), Map.of());
        } finally {
            if (tableRenamed) {
                try (var connection = database.connect(); var statement = connection.createStatement()) {
                    statement.execute("ALTER TABLE " + quotedSchema() + ".\"" + quarantinedTable
                            + "\" RENAME TO \"users\"");
                }
            }
        }

        Map<?, ?> failure = assertPrivateError(response, 500, "INTERNAL_ERROR", user.username(), user.mobile(),
                user.email(), session.accessToken(), quarantinedTable);
        String responseRequestId = response.headers().firstValue("X-Request-ID").orElseThrow();
        assertThat(failure.get("requestId")).isEqualTo(responseRequestId);
        assertThat(responseRequestId).isNotEqualTo(callerRequestId);
        assertThat(output.getAll()).doesNotContain(database.schema() + ".users", "does not exist", "PSQLException");
    }

    @Test
    void oldAccessTokenUsesCurrentRolesAndRejectsDeletedOrUnusableUsers() throws Exception {
        Credentials roleUser = uniqueUser("current-state");
        register(roleUser);
        SessionPayload roleSession = login(roleUser.username(), roleUser, "current-state", false);
        UUID roleUserId = userId(roleUser);

        var initialCurrent = currentUsers.authenticate(roleSession.accessToken());
        assertThat(initialCurrent.roles()).contains(UserRole.CUSTOMER);
        assertThat(initialCurrent.mobileVerified()).isFalse();

        removeRole(roleUserId, UserRole.CUSTOMER);

        var roleRemovedCurrent = currentUsers.authenticate(roleSession.accessToken());
        assertThat(roleRemovedCurrent.roles()).doesNotContain(UserRole.CUSTOMER);
        assertThat(roleRemovedCurrent.mobileVerified()).isFalse();
        var roleRemovedProfile = send("GET", "/api/user/me", null, requestId("role-removed"),
                "Bearer " + roleSession.accessToken(), Map.of());
        assertProfile(roleRemovedProfile, roleUser, false);

        Credentials unusableUser = uniqueUser("unusable");
        register(unusableUser);
        SessionPayload unusableSession = login(unusableUser.username(), unusableUser, "unusable", false);
        markPasswordVerifierMalformed(userId(unusableUser));

        assertThatThrownBy(() -> currentUsers.authenticate(unusableSession.accessToken()))
                .isInstanceOf(AuthenticationRequiredException.class);
        var unusableProfile = send("GET", "/api/user/me", null, requestId("unusable"),
                "Bearer " + unusableSession.accessToken(), Map.of());
        assertPrivateError(unusableProfile, 401, "AUTHENTICATION_REQUIRED", unusableSession.accessToken(),
                unusableUser.username(), unusableUser.mobile(), unusableUser.email());
        ReceivedCookie unusableCsrf = csrfCookie();
        var unusableRefresh = refresh(unusableSession.refreshCookie().value(), unusableCsrf.value(),
                unusableCsrf.value(), requestId("unusable-refresh"));
        assertPrivateError(unusableRefresh, 401, "AUTHENTICATION_REQUIRED", unusableSession.refreshCookie().value(),
                unusableCsrf.value(), unusableUser.username(), unusableUser.mobile(), unusableUser.email());
        assertThat(countRevoked(unusableUser, "user-unavailable")).isEqualTo(1);

        Credentials deletedUser = uniqueUser("deleted");
        register(deletedUser);
        SessionPayload deletedSession = login(deletedUser.username(), deletedUser, "deleted", false);
        deleteUser(userId(deletedUser));

        assertThatThrownBy(() -> currentUsers.authenticate(deletedSession.accessToken()))
                .isInstanceOf(AuthenticationRequiredException.class);
        var deletedProfile = send("GET", "/api/user/me", null, requestId("deleted"),
                "Bearer " + deletedSession.accessToken(), Map.of());
        assertPrivateError(deletedProfile, 401, "AUTHENTICATION_REQUIRED", deletedSession.accessToken(),
                deletedUser.username(), deletedUser.mobile(), deletedUser.email());
    }

    @Test
    void expiredSessionFamilyRejectsExistingAccessAndRefreshCredentials() throws Exception {
        Credentials user = uniqueUser("expired-family");
        register(user);
        SessionPayload session = login(user.username(), user, "expired-family", false);
        ReceivedCookie csrf = csrfCookie();
        expireSessionFamily(user);

        var profile = send("GET", "/api/user/me", null, requestId("expired-family-access"),
                "Bearer " + session.accessToken(), Map.of());
        assertPrivateError(profile, 401, "AUTHENTICATION_REQUIRED", session.accessToken(),
                user.username(), user.mobile(), user.email());
        var refreshResponse = refresh(session.refreshCookie().value(), csrf.value(), csrf.value(),
                requestId("expired-family-refresh"));
        assertPrivateError(refreshResponse, 401, "AUTHENTICATION_REQUIRED", session.refreshCookie().value(),
                csrf.value(), user.username(), user.mobile(), user.email());
    }

    @Test
    void refreshRotationReplayRevokesFamilyAndLogoutClearsCookieAndSession() throws Exception {
        Credentials replayUser = uniqueUser("replay");
        register(replayUser);
        SessionPayload initial = login(replayUser.username(), replayUser, "replay-login", false);
        ReceivedCookie csrf = csrfCookie();

        var missingCsrf = refresh(initial.refreshCookie().value(), csrf.value(), null, requestId("csrf-missing"));
        assertPrivateError(missingCsrf, 403, "ACCESS_DENIED", initial.refreshCookie().value(), csrf.value(),
                replayUser.username(), replayUser.mobile(), replayUser.email());
        var invalidCsrf = refresh(initial.refreshCookie().value(), csrf.value(), "wrong-csrf", requestId("csrf-fail"));
        assertPrivateError(invalidCsrf, 403, "ACCESS_DENIED", initial.refreshCookie().value(), csrf.value(),
                "wrong-csrf", replayUser.username(), replayUser.mobile(), replayUser.email());
        var disallowedOrigin = refresh(initial.refreshCookie().value(), csrf.value(), csrf.value(),
                requestId("origin-fail"), "https://evil.example.test");
        assertCorsFailure(disallowedOrigin, initial.refreshCookie().value(), csrf.value(),
                replayUser.username(), replayUser.mobile(), replayUser.email());

        SessionPayload rotated = session(refresh(initial.refreshCookie().value(), csrf.value(), csrf.value(), requestId("rotate")));
        assertThat(!rotated.accessToken().equals(initial.accessToken())).isTrue();
        assertThat(!rotated.refreshCookie().value().equals(initial.refreshCookie().value())).isTrue();

        var replay = refresh(initial.refreshCookie().value(), csrf.value(), csrf.value(), requestId("replay"));
        assertPrivateError(replay, 401, "AUTHENTICATION_REQUIRED", initial.refreshCookie().value(), csrf.value(),
                replayUser.username(), replayUser.mobile(), replayUser.email());
        assertThat(countRevoked(replayUser, "refresh-replay")).isEqualTo(1);

        var revokedAccess = send("GET", "/api/user/me", null, requestId("revoked-access"),
                "Bearer " + rotated.accessToken(), Map.of());
        assertPrivateError(revokedAccess, 401, "AUTHENTICATION_REQUIRED", rotated.accessToken(),
                replayUser.username(), replayUser.mobile(), replayUser.email());
        var revokedRefresh = refresh(rotated.refreshCookie().value(), csrf.value(), csrf.value(), requestId("revoked-refresh"));
        assertPrivateError(revokedRefresh, 401, "AUTHENTICATION_REQUIRED", rotated.refreshCookie().value(), csrf.value(),
                replayUser.username(), replayUser.mobile(), replayUser.email());

        Credentials logoutUser = uniqueUser("logout");
        register(logoutUser);
        SessionPayload logoutSession = login(logoutUser.username(), logoutUser, "logout-login", false);
        ReceivedCookie logoutCsrf = csrfCookie();
        assertThat(countSessions(logoutUser)).isEqualTo(1);
        assertThat(refreshGenerations(logoutUser)).containsExactly(new RefreshGeneration(0L, false));
        var missingLogoutCsrf = logout(logoutSession.refreshCookie().value(), null, requestId("logout-csrf-missing"));
        assertPrivateError(missingLogoutCsrf, 403, "ACCESS_DENIED", logoutSession.refreshCookie().value(),
                logoutCsrf.value(), logoutUser.username(), logoutUser.mobile(), logoutUser.email());
        var activeAfterRejectedLogout = send("GET", "/api/user/me", null, requestId("logout-csrf-still-active"),
                "Bearer " + logoutSession.accessToken(), Map.of());
        assertThat(activeAfterRejectedLogout.statusCode()).isEqualTo(200);
        var logout = logout(logoutSession.refreshCookie().value(), logoutCsrf.value(), requestId("logout"));
        assertThat(logout.statusCode()).isEqualTo(204);
        ReceivedCookie cleared = responseCookie(logout, "MW_REFRESH");
        assertThat(cleared.value().isBlank()).isTrue();
        assertThat(cleared.attributes()).contains("Max-Age=0", "Path=/api/auth", "HttpOnly", "SameSite=Lax");

        var repeatedLogout = logout(logoutSession.refreshCookie().value(), logoutCsrf.value(),
                requestId("logout-again"));
        assertThat(repeatedLogout.statusCode()).isEqualTo(204);
        responseCookie(repeatedLogout, "MW_REFRESH");
        assertThat(countRevoked(logoutUser, "logout")).isEqualTo(1);
        assertThat(countSessions(logoutUser)).isEqualTo(1);
        assertThat(refreshGenerations(logoutUser)).containsExactly(new RefreshGeneration(0L, false));

        var oldAccess = send("GET", "/api/user/me", null, requestId("old-access"),
                "Bearer " + logoutSession.accessToken(), Map.of());
        assertPrivateError(oldAccess, 401, "AUTHENTICATION_REQUIRED", logoutSession.accessToken(),
                logoutUser.username(), logoutUser.mobile(), logoutUser.email());
        var oldRefresh = refresh(logoutSession.refreshCookie().value(), logoutCsrf.value(), logoutCsrf.value(),
                requestId("old-refresh"));
        assertPrivateError(oldRefresh, 401, "AUTHENTICATION_REQUIRED", logoutSession.refreshCookie().value(),
                logoutCsrf.value(), logoutUser.username(), logoutUser.mobile(), logoutUser.email());
        assertThat(countRevoked(logoutUser, "logout")).isEqualTo(1);
    }

    @Test
    void logoutRevokesEverySessionRepresentedByDuplicateRefreshCookies() throws Exception {
        Credentials user = uniqueUser("duplicate-logout-cookie");
        register(user);
        SessionPayload firstSession = login(user.username(), user, "duplicate-logout-first", false);
        SessionPayload secondSession = login(user.username(), user, "duplicate-logout-second", false);
        ReceivedCookie csrf = csrfCookie();
        String duplicateCookies = "MW_REFRESH=" + firstSession.refreshCookie().value()
                + "; MW_REFRESH=" + secondSession.refreshCookie().value()
                + "; XSRF-TOKEN=" + csrf.value();
        Map<String, String> csrfProtectedHeaders = Map.of(
                "Cookie", duplicateCookies,
                "Origin", ALLOWED_ORIGIN);

        var missingCsrf = send("POST", "/api/auth/logout", null, requestId("duplicate-logout-csrf-missing"),
                null, csrfProtectedHeaders);
        assertPrivateError(missingCsrf, 403, "ACCESS_DENIED", firstSession.refreshCookie().value(),
                secondSession.refreshCookie().value(), csrf.value(), user.username(), user.mobile(), user.email());
        Map<String, String> invalidCsrfHeaders = new HashMap<>(csrfProtectedHeaders);
        invalidCsrfHeaders.put("X-XSRF-TOKEN", "wrong-csrf");
        var invalidCsrf = send("POST", "/api/auth/logout", null, requestId("duplicate-logout-csrf-invalid"),
                null, invalidCsrfHeaders);
        assertPrivateError(invalidCsrf, 403, "ACCESS_DENIED", firstSession.refreshCookie().value(),
                secondSession.refreshCookie().value(), csrf.value(), "wrong-csrf", user.username(),
                user.mobile(), user.email());
        for (SessionPayload session : Arrays.asList(firstSession, secondSession)) {
            var stillAuthenticated = send("GET", "/api/user/me", null, requestId("duplicate-logout-csrf-active"),
                    "Bearer " + session.accessToken(), Map.of());
            assertThat(stillAuthenticated.statusCode()).isEqualTo(200);
        }

        var response = send("POST", "/api/auth/logout", null, requestId("duplicate-logout"), null, Map.of(
                "Cookie", duplicateCookies,
                "X-XSRF-TOKEN", csrf.value(),
                "Origin", ALLOWED_ORIGIN));

        assertThat(response.statusCode()).isEqualTo(204);
        responseCookie(response, "MW_REFRESH");
        for (SessionPayload session : Arrays.asList(firstSession, secondSession)) {
            var revokedAccess = send("GET", "/api/user/me", null, requestId("duplicate-logout-access"),
                    "Bearer " + session.accessToken(), Map.of());
            assertThat(revokedAccess.statusCode()).isEqualTo(401);
            assertThat(refresh(session.refreshCookie().value(), csrf.value(), csrf.value(),
                    requestId("duplicate-logout-refresh")).statusCode()).isEqualTo(401);
        }
        assertThat(countRevoked(user, "logout")).isEqualTo(2);
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void logoutKeepsEverySessionActiveWhenAnyRevocationFailsAtCommit(CapturedOutput output) throws Exception {
        Credentials user = uniqueUser("logout-rollback");
        register(user);
        SessionPayload firstSession = login(user.username(), user, "logout-rollback-first", false);
        SessionPayload secondSession = login(user.username(), user, "logout-rollback-second", false);
        ReceivedCookie csrf = csrfCookie();
        String duplicateCookies = "MW_REFRESH=" + firstSession.refreshCookie().value()
                + "; MW_REFRESH=" + secondSession.refreshCookie().value()
                + "; XSRF-TOKEN=" + csrf.value();

        installFailingMultiLogoutCommitTrigger();
        HttpResponse<String> failedLogout;
        String failedRequestId = requestId("logout-rollback");
        try {
            failedLogout = send("POST", "/api/auth/logout", null, failedRequestId, null, Map.of(
                    "Cookie", duplicateCookies,
                    "X-XSRF-TOKEN", csrf.value(),
                    "Origin", ALLOWED_ORIGIN));
        } finally {
            removeFailingMultiLogoutCommitTrigger();
        }

        assertPrivateError(failedLogout, 500, "INTERNAL_ERROR", "synthetic deferred logout commit failure",
                firstSession.accessToken(), firstSession.refreshCookie().value(), secondSession.accessToken(),
                secondSession.refreshCookie().value(), csrf.value(), user.username(), user.mobile(), user.email(),
                user.password());
        assertCapturedOutputOmits(output, "synthetic deferred logout commit failure", firstSession.accessToken(),
                firstSession.refreshCookie().value(), secondSession.accessToken(),
                secondSession.refreshCookie().value(), csrf.value(), user.username(), user.mobile(), user.email(),
                user.password());
        for (SessionPayload session : Arrays.asList(firstSession, secondSession)) {
            var stillAuthenticated = send("GET", "/api/user/me", null, requestId("logout-rollback-active"),
                    "Bearer " + session.accessToken(), Map.of());
            assertThat(stillAuthenticated.statusCode()).isEqualTo(200);
        }
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void deferredConstraintFailureAtCommitRollsBackConsumptionAndLeavesOriginalRefreshUsable(
            CapturedOutput output) throws Exception {
        Credentials user = uniqueUser("rotation-failure");
        register(user);
        SessionPayload initial = login(user.username(), user, "rotation-failure", false);
        ReceivedCookie csrf = csrfCookie();

        assertThat(refreshGenerations(user)).containsExactly(new RefreshGeneration(0L, false));
        installFailingNextGenerationCommitTrigger(sessionId(user));
        HttpResponse<String> failedRotation;
        String failedRequestId = requestId("rotation-failure");
        try {
            failedRotation = refresh(initial.refreshCookie().value(), csrf.value(), csrf.value(),
                    failedRequestId);
        } finally {
            removeFailingNextGenerationCommitTrigger();
        }

        Map<?, ?> failure = assertPrivateError(failedRotation, 500, "INTERNAL_ERROR",
                "synthetic deferred refresh commit failure", initial.refreshCookie().value(), csrf.value(),
                user.username(), user.mobile(), user.email());
        String responseRequestId = failedRotation.headers().firstValue("X-Request-ID").orElseThrow();
        assertThat(failure.get("requestId")).isEqualTo(responseRequestId);
        assertThat(responseRequestId).isNotEqualTo(failedRequestId);
        var correlationEvents = output.getAll().lines()
                .filter(line -> line.contains("\"logger\":\"bd.mediwish.web.RequestCorrelationFilter\""))
                .filter(line -> line.contains("\"requestId\":\"" + responseRequestId + "\""))
                .toList();
        assertThat(correlationEvents).hasSize(1);
        assertThat(correlationEvents.getFirst())
                .contains("\"message\":\"HTTP response status=500\"")
                .doesNotContain("\"message\":\"HTTP response status=200\"");
        assertCapturedOutputOmits(output, "synthetic deferred refresh commit failure", failedRequestId,
                initial.refreshCookie().value(), csrf.value(), user.username(), user.mobile(), user.email());
        assertThat(refreshGenerations(user)).containsExactly(new RefreshGeneration(0L, false));

        SessionPayload recovered = session(refresh(initial.refreshCookie().value(), csrf.value(), csrf.value(),
                requestId("rotation-retry")));
        assertThat(recovered.refreshCookie().value()).isNotEqualTo(initial.refreshCookie().value());
        assertThat(refreshGenerations(user)).containsExactly(
                new RefreshGeneration(0L, true), new RefreshGeneration(1L, false));
    }

    @Test
    void postCommitRefreshResponseDroppedOnWireMakesOldCookieReplayRevokeTheFamily() throws Exception {
        Credentials user = uniqueUser("lost-refresh-response");
        register(user);
        SessionPayload initial = login(user.username(), user, "lost-refresh-response", false);
        ReceivedCookie csrf = csrfCookie();

        int upstreamStatus = sendRefreshAndDropResponseOnWire(initial.refreshCookie().value(), csrf.value(),
                requestId("response-dropped"));
        assertThat(upstreamStatus)
                .as("the API completed the refresh and committed it before the proxy dropped the response")
                .isEqualTo(200);
        assertThat(refreshGenerations(user)).containsExactly(
                new RefreshGeneration(0L, true), new RefreshGeneration(1L, false));

        var replay = refresh(initial.refreshCookie().value(), csrf.value(), csrf.value(),
                requestId("response-loss-retry"));
        assertPrivateError(replay, 401, "AUTHENTICATION_REQUIRED", initial.refreshCookie().value(), csrf.value(),
                user.username(), user.mobile(), user.email());
        assertThat(countRevoked(user, "refresh-replay")).isEqualTo(1);
        assertThat(refreshGenerations(user)).containsExactly(
                new RefreshGeneration(0L, true), new RefreshGeneration(1L, false));

        var oldAccess = send("GET", "/api/user/me", null, requestId("response-loss-access"),
                "Bearer " + initial.accessToken(), Map.of());
        assertPrivateError(oldAccess, 401, "AUTHENTICATION_REQUIRED", initial.accessToken(),
                user.username(), user.mobile(), user.email());
    }

    @Test
    void revokeAllForUserInvalidatesEverySessionFamily() throws Exception {
        Credentials user = uniqueUser("revoke-all");
        register(user);
        SessionPayload first = login(user.username(), user, "revoke-all-one", false);
        SessionPayload second = login(user.username(), user, "revoke-all-two", false);

        authentication.revokeAllForUser(userId(user), "test-revoke-all");

        assertThat(countRevoked(user, "test-revoke-all")).isEqualTo(2);
        var firstAccess = send("GET", "/api/user/me", null, requestId("revoke-all-access-one"),
                "Bearer " + first.accessToken(), Map.of());
        var secondAccess = send("GET", "/api/user/me", null, requestId("revoke-all-access-two"),
                "Bearer " + second.accessToken(), Map.of());
        assertPrivateError(firstAccess, 401, "AUTHENTICATION_REQUIRED", first.accessToken(), user.username(),
                user.mobile(), user.email());
        assertPrivateError(secondAccess, 401, "AUTHENTICATION_REQUIRED", second.accessToken(), user.username(),
                user.mobile(), user.email());

        ReceivedCookie csrf = csrfCookie();
        var firstRefresh = refresh(first.refreshCookie().value(), csrf.value(), csrf.value(),
                requestId("revoke-all-refresh-one"));
        var secondRefresh = refresh(second.refreshCookie().value(), csrf.value(), csrf.value(),
                requestId("revoke-all-refresh-two"));
        assertPrivateError(firstRefresh, 401, "AUTHENTICATION_REQUIRED", first.refreshCookie().value(), csrf.value(),
                user.username(), user.mobile(), user.email());
        assertPrivateError(secondRefresh, 401, "AUTHENTICATION_REQUIRED", second.refreshCookie().value(), csrf.value(),
                user.username(), user.mobile(), user.email());
    }

    private void register(Credentials user) throws Exception {
        var response = send("POST", "/api/auth/register", registrationJson(user),
                requestId("register"), null, Map.of());
        assertThat(response.statusCode()).isEqualTo(201);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactlyInAnyOrder(
                "username", "mobile", "email", "mobileVerificationDeferred");
        assertThat(keys(body)).doesNotContain("password", "passwordHash", "verifier", "role", "roles");
        assertThat(body.containsValue(user.password())).isFalse();
    }

    private void markMobileVerified(Credentials user) throws Exception {
        String sql = "UPDATE " + table("users") + " SET mobile_verified = TRUE WHERE username = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, user.username());
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private void storeLegacyEmailCase(Credentials user, String email) throws SQLException {
        String sql = "UPDATE " + table("users") + " SET email = ? WHERE username = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, email);
            statement.setString(2, user.username());
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private void assertEmailLookupIndexesAreNonUnique() throws SQLException {
        assertEmailLookupIndexIsAbsent("idx_users_email");
        assertNonUniqueEmailLookupIndex("idx_users_email_upper", "upper((email)::text)");
    }

    private void assertEmailLookupIndexIsAbsent(String indexName) throws SQLException {
        String sql = "SELECT count(*) FROM pg_indexes WHERE schemaname = ? AND tablename = 'users' "
                + "AND indexname = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, database.schema());
            statement.setString(2, indexName);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getLong(1)).as("the unused exact email index has been removed").isZero();
            }
        }
    }

    private void assertNonUniqueEmailLookupIndex(String indexName, String expression) throws SQLException {
        String sql = "SELECT indexdef FROM pg_indexes WHERE schemaname = ? AND tablename = 'users' "
                + "AND indexname = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, database.schema());
            statement.setString(2, indexName);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).as("Liquibase creates the %s email lookup index", indexName).isTrue();
                assertThat(result.getString(1).toLowerCase(Locale.ROOT))
                        .contains("using btree", expression)
                        .doesNotContain("unique");
                assertThat(result.next()).isFalse();
            }
        }
    }

    private UUID userId(Credentials user) throws Exception {
        String sql = "SELECT id FROM " + table("users") + " WHERE username = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, user.username());
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return UUID.fromString(result.getString(1));
            }
        }
    }

    private void removeRole(UUID userId, UserRole role) throws Exception {
        String sql = "DELETE FROM " + table("user_roles") + " WHERE user_id = ? AND role = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, userId);
            statement.setString(2, role.name());
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private void assignRole(UUID userId, UserRole role) throws Exception {
        String sql = "UPDATE " + table("user_roles") + " SET role = ? WHERE user_id = ? AND role = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, role.name());
            statement.setObject(2, userId);
            statement.setString(3, UserRole.CUSTOMER.name());
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private void expireSessionFamily(Credentials user) throws Exception {
        String sql = "UPDATE " + table("user_sessions") + " s SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'"
                + " FROM " + table("users") + " u WHERE s.user_id = u.id AND u.username = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, user.username());
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private void markPasswordVerifierMalformed(UUID userId) throws Exception {
        String sql = "UPDATE " + table("users") + " SET password_hash = 'not-an-argon2-verifier' WHERE id = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, userId);
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private void deleteUser(UUID userId) throws Exception {
        String sql = "DELETE FROM " + table("users") + " WHERE id = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, userId);
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private SessionPayload login(String identifier, Credentials expected, String prefix, boolean mobileVerified)
            throws Exception {
        var response = send("POST", "/api/auth/login", loginJson(identifier, expected.password()),
                requestId(prefix), null, Map.of());
        return session(response, expected, mobileVerified);
    }

    private ReceivedCookie csrfCookie() throws Exception {
        var response = send("GET", "/api/auth/csrf", null, requestId("csrf"), null, Map.of());
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactly("csrfToken");
        ReceivedCookie cookie = responseCookie(response, "XSRF-TOKEN");
        assertThat(body.get("csrfToken")).isEqualTo(cookie.value());
        return cookie;
    }

    private HttpResponse<String> refresh(String refresh, String csrfCookie, String csrfHeader, String requestId)
            throws Exception {
        return refresh(refresh, csrfCookie, csrfHeader, requestId, ALLOWED_ORIGIN);
    }

    private HttpResponse<String> refresh(String refresh, String csrfCookie, String csrfHeader, String requestId,
                                         String origin) throws Exception {
        String cookies = "XSRF-TOKEN=" + csrfCookie;
        if (refresh != null) cookies = "MW_REFRESH=" + refresh + "; " + cookies;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cookie", cookies);
        headers.put("Origin", origin);
        if (csrfHeader != null) headers.put("X-XSRF-TOKEN", csrfHeader);
        return send("POST", "/api/auth/refresh", null, requestId, null, headers);
    }

    private HttpResponse<String> logout(String refresh, String csrf, String requestId) throws Exception {
        String cookies = refresh == null
                ? "XSRF-TOKEN=" + csrf
                : "MW_REFRESH=" + refresh + "; XSRF-TOKEN=" + csrf;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cookie", cookies);
        headers.put("Origin", ALLOWED_ORIGIN);
        if (csrf != null) headers.put("X-XSRF-TOKEN", csrf);
        return send("POST", "/api/auth/logout", null, requestId, null, headers);
    }

    private SessionPayload session(HttpResponse<String> response, Credentials expected, boolean mobileVerified)
            throws Exception {
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactlyInAnyOrder("accessToken", "tokenType", "expiresIn", "user");
        String accessToken = body.get("accessToken") instanceof String value ? value : "";
        assertThat(!accessToken.isBlank()).isTrue();
        assertThat(body.get("tokenType")).isEqualTo("Bearer");
        long expiresIn = body.get("expiresIn") instanceof Number value ? value.longValue() : 0;
        assertThat(expiresIn).isPositive();
        Map<?, ?> user = body.get("user") instanceof Map<?, ?> value ? value : Map.of();
        assertThat(keys(user)).containsExactlyInAnyOrder("username", "mobile", "email", "mobileVerified");
        assertThat(user.get("username")).isEqualTo(expected.username());
        assertThat(user.get("mobile")).isEqualTo(expected.mobile());
        assertThat(user.get("email")).isEqualTo(expected.email());
        assertThat(user.get("mobileVerified")).isEqualTo(mobileVerified);
        assertThat(body.containsKey("refreshToken")).isFalse();
        assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
        return new SessionPayload(accessToken, responseCookie(response, "MW_REFRESH"));
    }

    private SessionPayload session(HttpResponse<String> response) throws Exception {
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        String accessToken = body.get("accessToken") instanceof String value ? value : "";
        assertThat(!accessToken.isBlank()).isTrue();
        assertThat(body.containsKey("refreshToken")).isFalse();
        return new SessionPayload(accessToken, responseCookie(response, "MW_REFRESH"));
    }

    private void assertProfile(HttpResponse<String> response, Credentials expected, boolean mobileVerified)
            throws Exception {
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactlyInAnyOrder("username", "mobile", "email", "mobileVerified");
        assertThat(body.get("username")).isEqualTo(expected.username());
        assertThat(body.get("mobile")).isEqualTo(expected.mobile());
        assertThat(body.get("email")).isEqualTo(expected.email());
        assertThat(body.get("mobileVerified")).isEqualTo(mobileVerified);
        assertThat(keys(body)).doesNotContain("password", "passwordHash", "role", "roles");
    }

    private Map<?, ?> assertError(HttpResponse<String> response, int status, String code) throws Exception {
        assertThat(response.statusCode()).isEqualTo(status);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactlyInAnyOrder("code", "message", "requestId");
        assertThat(body.get("code")).isEqualTo(code);
        assertThat(body.get("message")).isInstanceOf(String.class);
        assertThat(body.get("requestId")).isInstanceOf(String.class);
        assertThat(response.body().length()).isLessThan(512);
        assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(keys(body)).doesNotContain("password", "verifier", "refreshToken", "accessToken");
        return body;
    }

    private Map<?, ?> assertPrivateError(HttpResponse<String> response, int status, String code,
                                         String... forbiddenValues) throws Exception {
        Map<?, ?> body = assertError(response, status, code);
        assertNoSensitiveResponseValues(response, forbiddenValues);
        return body;
    }

    private void assertCorsFailure(HttpResponse<String> response, String... forbiddenValues) {
        assertThat(response.statusCode()).isEqualTo(403);
        Map<?, ?> body;
        try {
            body = json(response);
        } catch (Exception exception) {
            throw new AssertionError("CORS failure was not JSON", exception);
        }
        assertThat(keys(body)).containsExactlyInAnyOrder("code", "message", "requestId");
        assertThat(body.get("code")).isEqualTo("ACCESS_DENIED");
        assertThat(body.get("requestId")).isInstanceOf(String.class);
        assertThat(response.body().length()).isLessThan(512);
        assertNoSensitiveResponseValues(response, forbiddenValues);
    }

    private void assertNoSensitiveResponseValues(HttpResponse<String> response, String... forbiddenValues) {
        String headers = response.headers().map().toString();
        for (String forbidden : forbiddenValues) {
            if (forbidden == null || forbidden.isBlank()) continue;
            assertThat(response.body().contains(forbidden)).isFalse();
            assertThat(headers.contains(forbidden)).isFalse();
        }
    }

    private static void assertCapturedOutputOmits(CapturedOutput output, String... forbiddenValues) {
        String captured = output.getAll();
        for (String forbidden : forbiddenValues) {
            if (forbidden == null || forbidden.isBlank()) continue;
            assertThat(captured.contains(forbidden))
                    .as("captured structured application output omits synthetic sensitive values")
                    .isFalse();
        }
    }

    private Map<?, ?> json(HttpResponse<String> response) throws Exception {
        return JSON.readValue(response.body(), Map.class);
    }

    private static java.util.List<String> keys(Map<?, ?> body) {
        return body.keySet().stream().map(Object::toString).toList();
    }

    private long countRevoked(Credentials user, String reason) throws Exception {
        String sql = "SELECT count(*) FROM " + table("user_sessions")
                + " s JOIN " + table("users") + " u ON u.id = s.user_id"
                + " WHERE u.username = ? AND s.revoked_reason = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, user.username());
            statement.setString(2, reason);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return result.getLong(1);
            }
        }
    }

    private long countSessions(Credentials user) throws Exception {
        String sql = "SELECT count(*) FROM " + table("user_sessions")
                + " s JOIN " + table("users") + " u ON u.id = s.user_id WHERE u.username = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, user.username());
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return result.getLong(1);
            }
        }
    }

    private long countAllSessions() throws SQLException {
        String sql = "SELECT count(*) FROM " + table("user_sessions");
        try (var connection = database.connect(); var statement = connection.createStatement();
             var result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getLong(1);
        }
    }

    private String passwordVerifier(Credentials user) throws Exception {
        try (var connection = database.connect();
             var statement = connection.prepareStatement(
                     "SELECT password_hash FROM " + table("users") + " WHERE username = ?")) {
            statement.setString(1, user.username());
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).as("the registered User has a persisted password verifier").isTrue();
                String verifier = result.getString(1);
                assertThat(verifier).isNotBlank();
                assertThat(result.next()).as("the username identifies one registered User").isFalse();
                return verifier;
            }
        }
    }

    private java.util.List<RefreshGeneration> refreshGenerations(Credentials user) throws Exception {
        String sql = "SELECT t.generation, t.consumed_at IS NOT NULL FROM " + table("user_session_refresh_tokens")
                + " t JOIN " + table("user_sessions") + " s ON s.id = t.session_id"
                + " JOIN " + table("users") + " u ON u.id = s.user_id WHERE u.username = ? ORDER BY t.generation";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, user.username());
            try (var result = statement.executeQuery()) {
                var generations = new ArrayList<RefreshGeneration>();
                while (result.next()) generations.add(new RefreshGeneration(result.getLong(1), result.getBoolean(2)));
                return generations;
            }
        }
    }

    private UUID sessionId(Credentials user) throws Exception {
        String sql = "SELECT s.id FROM " + table("user_sessions") + " s JOIN " + table("users")
                + " u ON u.id = s.user_id WHERE u.username = ?";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, user.username());
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).as("the signed-in User has one session family").isTrue();
                UUID id = result.getObject(1, UUID.class);
                assertThat(result.next()).as("the fixture creates one session family").isFalse();
                return id;
            }
        }
    }

    private void installFailingNextGenerationCommitTrigger(UUID sessionId) throws SQLException {
        String schema = quotedSchema();
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            statement.execute("CREATE FUNCTION " + schema + ".ticket03_fail_next_refresh_at_commit() RETURNS trigger "
                    + "LANGUAGE plpgsql AS $$ BEGIN IF NEW.session_id = '" + sessionId
                    + "'::uuid AND NEW.generation = 1 THEN "
                    + "RAISE EXCEPTION 'synthetic deferred refresh commit failure'; END IF; RETURN NEW; END $$");
            statement.execute("CREATE CONSTRAINT TRIGGER ticket03_fail_next_refresh_at_commit AFTER INSERT ON " + schema
                    + ".user_session_refresh_tokens DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "
                    + schema + ".ticket03_fail_next_refresh_at_commit()");
        }
    }

    private void removeFailingNextGenerationCommitTrigger() throws SQLException {
        String schema = quotedSchema();
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            statement.execute("DROP TRIGGER IF EXISTS ticket03_fail_next_refresh_at_commit ON "
                    + schema + ".user_session_refresh_tokens");
            statement.execute("DROP FUNCTION IF EXISTS " + schema + ".ticket03_fail_next_refresh_at_commit()");
        }
    }

    private void installFailingMultiLogoutCommitTrigger() throws SQLException {
        String schema = quotedSchema();
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            statement.execute("CREATE FUNCTION " + schema + ".ticket03_fail_multi_logout_at_commit() RETURNS trigger "
                    + "LANGUAGE plpgsql AS $$ BEGIN IF NEW.revoked_reason = 'logout' AND OLD.revoked_at IS NULL "
                    + "AND (SELECT count(*) FROM " + table("user_sessions")
                    + " WHERE user_id = NEW.user_id AND revoked_reason = 'logout') > 1 THEN "
                    + "RAISE EXCEPTION 'synthetic deferred logout commit failure'; END IF; RETURN NEW; END $$");
            statement.execute("CREATE CONSTRAINT TRIGGER ticket03_fail_multi_logout_at_commit AFTER UPDATE ON "
                    + table("user_sessions") + " DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "
                    + schema + ".ticket03_fail_multi_logout_at_commit()");
        }
    }

    private void removeFailingMultiLogoutCommitTrigger() throws SQLException {
        String schema = quotedSchema();
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            statement.execute("DROP TRIGGER IF EXISTS ticket03_fail_multi_logout_at_commit ON "
                    + table("user_sessions"));
            statement.execute("DROP FUNCTION IF EXISTS " + schema + ".ticket03_fail_multi_logout_at_commit()");
        }
    }

    private int sendRefreshAndDropResponseOnWire(String refreshToken, String csrfToken, String requestId)
            throws Exception {
        try (var proxy = new ResponseDroppingTcpProxy(base);
             var socket = new Socket(InetAddress.getLoopbackAddress(), proxy.port())) {
            socket.setSoTimeout(10_000);
            String request = "POST /api/auth/refresh HTTP/1.1\r\n"
                    + "Host: " + base.getAuthority() + "\r\n"
                    + "X-Request-ID: " + requestId + "\r\n"
                    + "Cookie: MW_REFRESH=" + refreshToken + "; XSRF-TOKEN=" + csrfToken + "\r\n"
                    + "Origin: " + ALLOWED_ORIGIN + "\r\n"
                    + "X-XSRF-TOKEN: " + csrfToken + "\r\n"
                    + "Content-Length: 0\r\n"
                    + "Connection: close\r\n\r\n";
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().flush();

            try (var received = new ByteArrayOutputStream()) {
                socket.getInputStream().transferTo(received);
                assertThat(received.size())
                        .as("the client-side TCP connection receives no response status, cookie or body bytes")
                        .isZero();
            }
            return proxy.awaitDroppedResponseStatus(Duration.ofSeconds(5));
        }
    }

    private String quotedSchema() {
        assertThat(database.schema()).matches("mw_it_[a-f0-9]{32}");
        return "\"" + database.schema() + "\"";
    }

    private String table(String name) {
        assertThat(database.schema()).matches("mw_it_[a-f0-9]{32}");
        return "\"" + database.schema() + "\".\"" + name + "\"";
    }

    private HttpResponse<String> send(String method, String path, String body, String requestId,
                                      String authorization, Map<String, String> headers) throws Exception {
        var builder = HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(10))
                .header("X-Request-ID", requestId);
        if (body != null) builder.header("Content-Type", "application/json");
        if (authorization != null) builder.header("Authorization", authorization);
        headers.forEach(builder::header);
        var publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body);
        return client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString());
    }

    private static ReceivedCookie responseCookie(HttpResponse<?> response, String name) {
        String prefix = name + "=";
        String header = response.headers().allValues("Set-Cookie").stream()
                .filter(value -> value.startsWith(prefix)).findFirst().orElseThrow();
        String[] parts = header.split(";", -1);
        String value = parts[0].substring(prefix.length());
        String attributes = parts.length == 1 ? "" : String.join(";", Arrays.copyOfRange(parts, 1, parts.length));
        return new ReceivedCookie(name, value, attributes);
    }

    private static Credentials uniqueUser(String prefix) {
        String suffix = UUID.randomUUID().toString().replace("-", "");
        return new Credentials(prefix + "_" + suffix.substring(0, 12),
                "017" + suffix.substring(12, 21),
                prefix + "." + suffix.substring(20, 32) + "@example.test",
                "synthetic-" + suffix + "-password");
    }

    private static String registrationJson(Credentials user) {
        return """
                {"username":"%s","mobile":"%s","email":"%s","password":"%s"}
                """.formatted(user.username(), user.mobile(), user.email(), user.password());
    }

    private static String loginJson(String identifier, String password) {
        return """
                {"identifier":"%s","password":"%s"}
                """.formatted(identifier, password);
    }

    private static String requestId(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    private record Credentials(String username, String mobile, String email, String password) {}

    private record ReceivedCookie(String name, String value, String attributes) {}

    private record SessionPayload(String accessToken, ReceivedCookie refreshCookie) {}

    private record RefreshGeneration(long generation, boolean consumed) {}
}
