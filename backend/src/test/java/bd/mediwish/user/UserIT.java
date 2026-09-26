package bd.mediwish.user;

import bd.mediwish.MediWishApplication;
import bd.mediwish.health.TestDatabase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
@Tag("regression")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class UserIT {
    private static final String ALLOWED_ORIGIN = "http://127.0.0.1:3000";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private HttpClient client;
    private TestDatabase database;
    private ConfigurableApplicationContext application;
    private URI base;

    @BeforeAll
    void startAgainstIsolatedPostgresSchema() throws Exception {
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
        database = TestDatabase.create();
        var properties = new HashMap<>(database.applicationProperties());
        properties.put("app.auth.access-token-lifetime", "PT5M");
        var launcher = new SpringApplication(MediWishApplication.class);
        launcher.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("isolated-user-integration", properties)));
        application = launcher.run();
        base = URI.create("http://127.0.0.1:"
                + application.getEnvironment().getRequiredProperty("local.server.port"));
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
    void registrationReturnsSafeDeferredProjectionAndBearerProfileUsesRefreshCookie() throws Exception {
        Credentials user = uniqueUser("profile");
        String registrationRequestId = requestId("register");
        var registered = send("POST", "/api/auth/register", registrationJson(user),
                registrationRequestId, null, Map.of());

        assertThat(registered.statusCode()).isEqualTo(201);
        Map<?, ?> registeredBody = json(registered);
        assertThat(keys(registeredBody)).containsExactlyInAnyOrder(
                "username", "mobile", "email", "mobileVerificationDeferred");
        assertThat(registeredBody.get("username")).isEqualTo(user.username());
        assertThat(registeredBody.get("mobile")).isEqualTo(user.mobile());
        assertThat(registeredBody.get("email")).isEqualTo(user.email());
        assertThat(registeredBody.get("mobileVerificationDeferred")).isEqualTo(true);
        assertThat(keys(registeredBody)).doesNotContain(
                "password", "passwordHash", "verifier", "role", "roles");
        assertThat(registeredBody.containsValue(user.password())).isFalse();
        assertThat(registered.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(registered.headers().firstValue("X-Request-ID").orElseThrow())
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                .isNotEqualTo(registrationRequestId);

        var anonymous = send("GET", "/api/user/me", null, requestId("anonymous"), null, Map.of());
        assertError(anonymous, 401, "AUTHENTICATION_REQUIRED");
        assertThat(anonymous.headers().firstValue("WWW-Authenticate")).contains("Bearer");
        assertThat(anonymous.headers().firstValue("WWW-Authenticate").orElse("").contains("Basic")).isFalse();

        var login = send("POST", "/api/auth/login", loginJson(user.username(), user.password()),
                requestId("login"), null, Map.of());
        SessionPayload firstSession = session(login);
        String cookieAttributes = firstSession.refreshCookie().attributes();
        assertThat(cookieAttributes).contains("Path=/api/auth", "HttpOnly", "SameSite=Lax");
        String maxAge = cookieAttributes.split("Max-Age=", 2)[1].split(";", 2)[0];
        assertThat(Long.parseLong(maxAge))
                .isBetween(1L, java.time.Duration.ofDays(30).toSeconds());
        assertThat(firstSession.refreshCookie().attributes().toLowerCase().contains("secure")).isFalse();

        ReceivedCookie csrf = csrfCookie();
        var refreshed = refresh(firstSession.refreshCookie().value(), csrf.value(), requestId("refresh"));
        SessionPayload rotatedSession = session(refreshed);
        assertThat(!rotatedSession.accessToken().equals(firstSession.accessToken())).isTrue();
        assertThat(!rotatedSession.refreshCookie().value().equals(firstSession.refreshCookie().value())).isTrue();

        var profile = send("GET", "/api/user/me", null, requestId("profile"),
                "Bearer " + rotatedSession.accessToken(), Map.of());
        assertProfile(profile, user);

    }

    @Test
    void duplicateRegistrationAndCredentialedCorsPreflightHaveBoundedOutcomes() throws Exception {
        Credentials user = uniqueUser("duplicate");
        String request = registrationJson(user);
        assertThat(send("POST", "/api/auth/register", request, requestId("first"), null, Map.of())
                .statusCode()).isEqualTo(201);

        var duplicate = send("POST", "/api/auth/register", request, requestId("duplicate"), null, Map.of());
        assertError(duplicate, 409, "DUPLICATE_USER");

        var preflight = HttpRequest.newBuilder(base.resolve("/api/auth/refresh"))
                .timeout(Duration.ofSeconds(10))
                .header("Origin", ALLOWED_ORIGIN)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "content-type,x-xsrf-token")
                .header("X-Request-ID", requestId("preflight"))
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody())
                .build();
        var cors = client.send(preflight, HttpResponse.BodyHandlers.ofString());
        assertThat(cors.statusCode()).isIn(200, 204);
        assertThat(cors.headers().firstValue("Access-Control-Allow-Origin")).contains(ALLOWED_ORIGIN);
        assertThat(cors.headers().firstValue("Access-Control-Allow-Credentials")).contains("true");
        assertThat(cors.headers().firstValue("Access-Control-Allow-Methods").orElse(""))
                .contains("POST");
        assertThat(cors.headers().firstValue("Access-Control-Allow-Headers").orElse("").toLowerCase())
                .contains("x-xsrf-token");
    }

    @Test
    void registrationCannotAssignCallerSuppliedStaffRoles() throws Exception {
        Credentials user = uniqueUser("role_attempt");
        var response = send("POST", "/api/auth/register", registrationJsonWithStaffRoleAttempt(user),
                requestId("role-attempt"), null, Map.of());
        var users = application.getBean(UserRepository.class);
        var persistedUser = users.findByUsername(user.username());

        assertThat(response.statusCode()).isIn(201, 400);
        if (response.statusCode() == 201) {
            assertThat(persistedUser).isPresent();
            assertThat(persistedUser.orElseThrow().roles())
                    .containsExactly(UserRole.CUSTOMER);
        } else {
            assertError(response, 400, "INVALID_REQUEST");
            assertThat(persistedUser).isEmpty();
        }
    }

    @Test
    void concurrentRegistrationsWithDistinctUsernamesAndSharedMobileUseDatabaseUniqueness() throws Exception {
        Credentials user = uniqueUser("race");
        Credentials uniqueOtherUser = uniqueUser("race_other");
        Credentials differentUsername = new Credentials(uniqueOtherUser.username(), user.mobile(),
                uniqueOtherUser.email(), uniqueOtherUser.password());
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> registerAfter(start, registrationJson(user), requestId("race-a")));
            var second = executor.submit(() -> registerAfter(start,
                    registrationJson(differentUsername), requestId("race-b")));
            start.countDown();
            var responses = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
            assertThat(responses.stream().map(HttpResponse::statusCode).sorted().toList())
                    .containsExactly(201, 409);
            var duplicate = responses.stream().filter(response -> response.statusCode() == 409)
                    .findFirst().orElseThrow();
            assertError(duplicate, 409, "DUPLICATE_USER");
        }
    }

    @Test
    void concurrentRegistrationsWithSameNormalizedUsernameAndDistinctMobilesPersistOneUser() throws Exception {
        Credentials user = uniqueUser("username_race");
        Credentials other = uniqueUser("username_race_other");
        Credentials normalizedVariant = new Credentials(" " + user.username().toUpperCase(Locale.ROOT) + " ",
                other.mobile(), other.email(), other.password());
        String normalizedUsername = user.username();
        assertThat(normalizedVariant.mobile()).isNotEqualTo(user.mobile());

        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> registerAfterBarrier(ready, start,
                    registrationJson(user), requestId("username-race-a")));
            var second = executor.submit(() -> registerAfterBarrier(ready, start,
                    registrationJson(normalizedVariant), requestId("username-race-b")));
            boolean bothReady = ready.await(10, TimeUnit.SECONDS);
            start.countDown();
            assertThat(bothReady).as("both registration requests reached the start barrier").isTrue();

            var responses = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
            assertThat(responses.stream().map(HttpResponse::statusCode).sorted().toList())
                    .containsExactly(201, 409);
            var winner = responses.stream().filter(response -> response.statusCode() == 201)
                    .findFirst().orElseThrow();
            var duplicate = responses.stream().filter(response -> response.statusCode() == 409)
                    .findFirst().orElseThrow();
            assertError(duplicate, 409, "DUPLICATE_USER");

            var persisted = application.getBean(UserRepository.class).findAll().stream()
                    .filter(candidate -> candidate.username().equals(normalizedUsername))
                    .toList();
            assertThat(persisted).hasSize(1);
            assertThat(persisted.getFirst().mobile()).isIn(user.mobile(), normalizedVariant.mobile());
            assertThat(json(winner).get("username")).isEqualTo(normalizedUsername);
            assertThat(json(winner).get("mobile")).isEqualTo(persisted.getFirst().mobile());
        }
    }

    private HttpResponse<String> registerAfter(CountDownLatch start, String request, String requestId)
            throws Exception {
        start.await(10, TimeUnit.SECONDS);
        return send("POST", "/api/auth/register", request, requestId, null, Map.of());
    }

    private HttpResponse<String> registerAfterBarrier(CountDownLatch ready, CountDownLatch start,
                                                       String request, String requestId) throws Exception {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) {
            throw new IllegalStateException("Registration race did not reach its start barrier");
        }
        return send("POST", "/api/auth/register", request, requestId, null, Map.of());
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

    private HttpResponse<String> refresh(String refresh, String csrf, String requestId) throws Exception {
        return send("POST", "/api/auth/refresh", null, requestId, null, Map.of(
                "Cookie", "MW_REFRESH=" + refresh + "; XSRF-TOKEN=" + csrf,
                "X-XSRF-TOKEN", csrf,
                "Origin", ALLOWED_ORIGIN));
    }

    private SessionPayload session(HttpResponse<String> response) throws Exception {
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
        assertThat(body.containsKey("refreshToken")).isFalse();
        return new SessionPayload(accessToken, responseCookie(response, "MW_REFRESH"));
    }

    private void assertProfile(HttpResponse<String> response, Credentials expected) throws Exception {
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactlyInAnyOrder("username", "mobile", "email", "mobileVerified");
        assertThat(body.get("username")).isEqualTo(expected.username());
        assertThat(body.get("mobile")).isEqualTo(expected.mobile());
        assertThat(body.get("email")).isEqualTo(expected.email());
        assertThat(body.get("mobileVerified")).isEqualTo(false);
        assertThat(keys(body)).doesNotContain("password", "passwordHash", "role", "roles");
    }

    private void assertError(HttpResponse<String> response, int status, String code) throws Exception {
        assertThat(response.statusCode()).isEqualTo(status);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactlyInAnyOrder("code", "message", "requestId");
        assertThat(body.get("code")).isEqualTo(code);
        assertThat(body.get("message")).isInstanceOf(String.class);
        assertThat(body.get("requestId")).isInstanceOf(String.class);
        assertThat(body.get("requestId")).isEqualTo(response.headers().firstValue("X-Request-ID").orElseThrow());
        assertThat(response.body().length()).isLessThan(512);
        assertThat(keys(body)).doesNotContain("password", "verifier", "refreshToken", "accessToken");
    }

    private Map<?, ?> json(HttpResponse<String> response) throws Exception {
        return JSON.readValue(response.body(), Map.class);
    }

    private static List<String> keys(Map<?, ?> body) {
        return body.keySet().stream().map(Object::toString).toList();
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
        String first = parts[0];
        String value = first.substring(prefix.length());
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

    private static String registrationJsonWithStaffRoleAttempt(Credentials user) {
        return """
                {"username":"%s","mobile":"%s","email":"%s","password":"%s",
                 "role":"ADMIN","roles":["ADMIN"]}
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
}
