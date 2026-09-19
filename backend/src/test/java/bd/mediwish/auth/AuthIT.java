package bd.mediwish.auth;

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
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.time.Duration;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

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

    @BeforeAll
    void startAgainstIsolatedPostgresSchema() throws Exception {
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
        database = TestDatabase.create();
        var properties = new HashMap<>(database.applicationProperties());
        properties.put("app.auth.access-token-lifetime", "PT5M");
        var launcher = new SpringApplication(MediWishApplication.class);
        launcher.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("isolated-auth-integration", properties)));
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
        assertError(basic, 401, "AUTHENTICATION_REQUIRED");
        assertThat(basic.headers().firstValue("WWW-Authenticate")).contains("Bearer");

        var wrongPassword = send("POST", "/api/auth/login",
                loginJson(user.username(), "wrong-" + UUID.randomUUID().toString().replace("-", "")),
                requestId("wrong"), null, Map.of());
        var unknownIdentifier = send("POST", "/api/auth/login",
                loginJson("missing_" + UUID.randomUUID().toString().replace("-", ""),
                        "wrong-" + UUID.randomUUID().toString().replace("-", "")),
                requestId("unknown"), null, Map.of());
        Map<?, ?> wrongBody = assertError(wrongPassword, 401, "AUTHENTICATION_FAILED");
        Map<?, ?> unknownBody = assertError(unknownIdentifier, 401, "AUTHENTICATION_FAILED");
        assertThat(wrongBody.get("message")).isEqualTo(unknownBody.get("message"));
    }

    @Test
    void refreshRotationReplayRevokesFamilyAndLogoutClearsCookieAndSession() throws Exception {
        Credentials replayUser = uniqueUser("replay");
        register(replayUser);
        SessionPayload initial = login(replayUser.username(), replayUser, "replay-login", false);
        ReceivedCookie csrf = csrfCookie();

        var invalidCsrf = refresh(initial.refreshCookie().value(), csrf.value(), "wrong-csrf", requestId("csrf-fail"));
        assertError(invalidCsrf, 403, "ACCESS_DENIED");

        SessionPayload rotated = session(refresh(initial.refreshCookie().value(), csrf.value(), csrf.value(), requestId("rotate")));
        assertThat(!rotated.accessToken().equals(initial.accessToken())).isTrue();
        assertThat(!rotated.refreshCookie().value().equals(initial.refreshCookie().value())).isTrue();

        var replay = refresh(initial.refreshCookie().value(), csrf.value(), csrf.value(), requestId("replay"));
        assertError(replay, 401, "AUTHENTICATION_REQUIRED");
        assertThat(countRevoked(replayUser, "refresh-replay")).isEqualTo(1);

        var revokedAccess = send("GET", "/api/user/me", null, requestId("revoked-access"),
                "Bearer " + rotated.accessToken(), Map.of());
        assertError(revokedAccess, 401, "AUTHENTICATION_REQUIRED");
        var revokedRefresh = refresh(rotated.refreshCookie().value(), csrf.value(), csrf.value(), requestId("revoked-refresh"));
        assertError(revokedRefresh, 401, "AUTHENTICATION_REQUIRED");

        Credentials logoutUser = uniqueUser("logout");
        register(logoutUser);
        SessionPayload logoutSession = login(logoutUser.username(), logoutUser, "logout-login", false);
        ReceivedCookie logoutCsrf = csrfCookie();
        var logout = logout(logoutSession.refreshCookie().value(), logoutCsrf.value(), requestId("logout"));
        assertThat(logout.statusCode()).isEqualTo(204);
        ReceivedCookie cleared = responseCookie(logout, "MW_REFRESH");
        assertThat(cleared.value().isBlank()).isTrue();
        assertThat(cleared.attributes()).contains("Max-Age=0", "Path=/api/auth", "HttpOnly", "SameSite=Lax");

        var oldAccess = send("GET", "/api/user/me", null, requestId("old-access"),
                "Bearer " + logoutSession.accessToken(), Map.of());
        assertError(oldAccess, 401, "AUTHENTICATION_REQUIRED");
        var oldRefresh = refresh(logoutSession.refreshCookie().value(), logoutCsrf.value(), logoutCsrf.value(),
                requestId("old-refresh"));
        assertError(oldRefresh, 401, "AUTHENTICATION_REQUIRED");
        assertThat(countRevoked(logoutUser, "logout")).isEqualTo(1);

        var repeatedLogout = logout(null, logoutCsrf.value(), requestId("logout-again"));
        assertThat(repeatedLogout.statusCode()).isEqualTo(204);
        responseCookie(repeatedLogout, "MW_REFRESH");
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
        String cookies = "XSRF-TOKEN=" + csrfCookie;
        if (refresh != null) cookies = "MW_REFRESH=" + refresh + "; " + cookies;
        return send("POST", "/api/auth/refresh", null, requestId, null, Map.of(
                "Cookie", cookies,
                "X-XSRF-TOKEN", csrfHeader,
                "Origin", ALLOWED_ORIGIN));
    }

    private HttpResponse<String> logout(String refresh, String csrf, String requestId) throws Exception {
        String cookies = refresh == null
                ? "XSRF-TOKEN=" + csrf
                : "MW_REFRESH=" + refresh + "; XSRF-TOKEN=" + csrf;
        return send("POST", "/api/auth/logout", null, requestId, null, Map.of(
                "Cookie", cookies,
                "X-XSRF-TOKEN", csrf,
                "Origin", ALLOWED_ORIGIN));
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
        assertThat(keys(body)).doesNotContain("password", "verifier", "refreshToken", "accessToken");
        return body;
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
}
