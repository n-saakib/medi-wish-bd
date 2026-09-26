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
import java.sql.PreparedStatement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
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
class ConcurrentRefreshIT {
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
                new MapPropertySource("isolated-concurrent-refresh-integration", properties)));
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
    void concurrentRefreshConsumesCookieOnceAndRevokesWinningSessionFamily() throws Exception {
        Credentials user = uniqueUser("concurrent");
        register(user);
        SessionPayload initial = login(user);
        ReceivedCookie csrf = csrfCookie();
        CountDownLatch start = new CountDownLatch(1);

        List<HttpResponse<String>> responses;
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> refreshAfter(start, initial.refreshCookie().value(), csrf.value(),
                    requestId("refresh-a")));
            var second = executor.submit(() -> refreshAfter(start, initial.refreshCookie().value(), csrf.value(),
                    requestId("refresh-b")));
            start.countDown();
            responses = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
        }

        assertThat(responses.stream().map(HttpResponse::statusCode).sorted().toList())
                .containsExactly(200, 401);
        HttpResponse<String> winnerResponse = responses.stream()
                .filter(response -> response.statusCode() == 200)
                .findFirst().orElseThrow();
        HttpResponse<String> loserResponse = responses.stream()
                .filter(response -> response.statusCode() == 401)
                .findFirst().orElseThrow();
        assertError(loserResponse, 401, "AUTHENTICATION_REQUIRED");

        SessionPayload winner = session(winnerResponse);
        assertThat(countRevoked(user, "refresh-replay")).isEqualTo(1);

        var revokedAccess = send("GET", "/api/user/me", null, requestId("revoked-access"),
                "Bearer " + winner.accessToken(), Map.of());
        assertError(revokedAccess, 401, "AUTHENTICATION_REQUIRED");

        var revokedRefresh = refreshAfter(new CountDownLatch(0), winner.refreshCookie().value(), csrf.value(),
                requestId("revoked-refresh"));
        assertError(revokedRefresh, 401, "AUTHENTICATION_REQUIRED");
    }

    @Test
    void malformedGuessedAlteredAndDuplicateRefreshCookiesAreRejectedWithoutConsumingValidCredential()
            throws Exception {
        Credentials user = uniqueUser("invalid-refresh");
        register(user);
        SessionPayload initial = login(user);
        ReceivedCookie csrf = csrfCookie();
        String validRefresh = initial.refreshCookie().value();
        String truncatedRefresh = validRefresh.substring(0, validRefresh.length() / 2);
        String alteredRefresh = (validRefresh.charAt(0) == 'a' ? "b" : "a") + validRefresh.substring(1);
        String guessedRefresh = UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", "").substring(0, 11);
        assertThat(guessedRefresh).matches("[A-Za-z0-9_-]{43}");
        List<String> invalidCookieHeaders = List.of(
                "MW_REFRESH=; XSRF-TOKEN=" + csrf.value(),
                "MW_REFRESH=" + truncatedRefresh + "; XSRF-TOKEN=" + csrf.value(),
                "MW_REFRESH=" + alteredRefresh + "; XSRF-TOKEN=" + csrf.value(),
                "MW_REFRESH=" + guessedRefresh + "; XSRF-TOKEN=" + csrf.value(),
                "MW_REFRESH=" + validRefresh + "; MW_REFRESH=" + validRefresh
                        + "; XSRF-TOKEN=" + csrf.value(),
                "MW_REFRESH=" + validRefresh + "; MW_REFRESH=" + alteredRefresh
                        + "; XSRF-TOKEN=" + csrf.value());

        String genericMessage = null;
        for (String cookieHeader : invalidCookieHeaders) {
            HttpResponse<String> response = refreshWithCookieHeader(cookieHeader, csrf.value(),
                    requestId("invalid-refresh"));
            Map<?, ?> error = assertError(response, 401, "AUTHENTICATION_REQUIRED");
            if (genericMessage == null) genericMessage = error.get("message").toString();
            assertThat(error.get("message")).isEqualTo(genericMessage);
            assertThat(response.body()).doesNotContain(validRefresh, truncatedRefresh, alteredRefresh,
                    guessedRefresh, csrf.value());
            assertThat(response.headers().allValues("Set-Cookie"))
                    .noneMatch(value -> value.startsWith("MW_REFRESH="));
        }

        SessionPayload accepted = session(refreshWithCookieHeader(
                "MW_REFRESH=" + validRefresh + "; XSRF-TOKEN=" + csrf.value(),
                csrf.value(), requestId("valid-after-invalid-refreshes")));
        assertThat(accepted.refreshCookie().value()).isNotEqualTo(validRefresh);
    }

    @Test
    void logoutRacingRefreshRevokesFamilyWithoutCreatingExtraSessionOrGeneration() throws Exception {
        Credentials user = uniqueUser("logout-refresh-race");
        register(user);
        SessionPayload initial = login(user);
        ReceivedCookie csrf = csrfCookie();
        CountDownLatch start = new CountDownLatch(1);

        HttpResponse<String> refreshResponse;
        HttpResponse<String> logoutResponse;
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var refresh = executor.submit(() -> refreshAfter(start, initial.refreshCookie().value(), csrf.value(),
                    requestId("logout-race-refresh")));
            var logout = executor.submit(() -> logoutAfter(start, initial.refreshCookie().value(), csrf.value(),
                    requestId("logout-race-logout")));
            start.countDown();
            refreshResponse = refresh.get(20, TimeUnit.SECONDS);
            logoutResponse = logout.get(20, TimeUnit.SECONDS);
        }

        assertThat(logoutResponse.statusCode()).isEqualTo(204);
        ReceivedCookie cleared = responseCookie(logoutResponse, "MW_REFRESH");
        assertThat(cleared.value()).isEmpty();
        assertThat(refreshResponse.statusCode()).isIn(200, 401);
        SessionPayload rotated = refreshResponse.statusCode() == 200
                ? session(refreshResponse)
                : null;
        if (rotated == null) assertError(refreshResponse, 401, "AUTHENTICATION_REQUIRED");

        assertThat(countRevoked(user, "logout")).isEqualTo(1);
        assertThat(countSessions(user)).isEqualTo(1);
        assertThat(refreshGenerations(user)).containsExactlyElementsOf(
                rotated == null ? List.of(0L) : List.of(0L, 1L));
        assertError(send("GET", "/api/user/me", null, requestId("logout-race-old-access"),
                "Bearer " + initial.accessToken(), Map.of()), 401, "AUTHENTICATION_REQUIRED");
        if (rotated != null) {
            assertError(send("GET", "/api/user/me", null, requestId("logout-race-rotated-access"),
                    "Bearer " + rotated.accessToken(), Map.of()), 401, "AUTHENTICATION_REQUIRED");
            assertError(refreshAfter(new CountDownLatch(0), rotated.refreshCookie().value(), csrf.value(),
                    requestId("logout-race-rotated-refresh")), 401, "AUTHENTICATION_REQUIRED");
        }
    }

    @Test
    void logoutRequestsWithOppositeCookieOrderRevokeBothSessionFamilies() throws Exception {
        Credentials user = uniqueUser("reverse-order-logout");
        register(user);
        SessionPayload first = login(user);
        SessionPayload second = login(user);
        ReceivedCookie csrf = csrfCookie();
        List<String> refreshTokens = List.of(first.refreshCookie().value(), second.refreshCookie().value());
        CountDownLatch start = new CountDownLatch(1);

        List<HttpResponse<String>> responses;
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var forward = executor.submit(() -> logoutAfter(start, refreshTokens, csrf.value(),
                    requestId("logout-order-forward")));
            var reverse = executor.submit(() -> logoutAfter(start, List.of(
                    refreshTokens.get(1), refreshTokens.get(0)), csrf.value(), requestId("logout-order-reverse")));
            start.countDown();
            responses = List.of(forward.get(20, TimeUnit.SECONDS), reverse.get(20, TimeUnit.SECONDS));
        }

        assertThat(responses.stream().map(HttpResponse::statusCode).toList()).containsExactly(204, 204);
        for (HttpResponse<String> response : responses) {
            assertThat(responseCookie(response, "MW_REFRESH").value()).isEmpty();
        }
        assertThat(countRevoked(user, "logout")).isEqualTo(2);
        assertThat(countSessions(user)).isEqualTo(2);

        for (SessionPayload session : List.of(first, second)) {
            assertError(send("GET", "/api/user/me", null, requestId("logout-order-access"),
                    "Bearer " + session.accessToken(), Map.of()), 401, "AUTHENTICATION_REQUIRED");
            assertError(refreshWithCookieHeader("MW_REFRESH=" + session.refreshCookie().value()
                    + "; XSRF-TOKEN=" + csrf.value(), csrf.value(), requestId("logout-order-refresh")),
                    401, "AUTHENTICATION_REQUIRED");
        }
    }

    private HttpResponse<String> refreshAfter(CountDownLatch start, String refresh, String csrf, String requestId)
            throws Exception {
        if (!start.await(10, TimeUnit.SECONDS)) throw new AssertionError("refresh start barrier timed out");
        return refreshWithCookieHeader("MW_REFRESH=" + refresh + "; XSRF-TOKEN=" + csrf, csrf, requestId);
    }

    private HttpResponse<String> refreshWithCookieHeader(String cookieHeader, String csrf, String requestId)
            throws Exception {
        return send("POST", "/api/auth/refresh", null, requestId, null, Map.of(
                "Cookie", cookieHeader,
                "X-XSRF-TOKEN", csrf,
                "Origin", ALLOWED_ORIGIN));
    }

    private HttpResponse<String> logoutAfter(CountDownLatch start, String refresh, String csrf, String requestId)
            throws Exception {
        return logoutAfter(start, List.of(refresh), csrf, requestId);
    }

    private HttpResponse<String> logoutAfter(CountDownLatch start, List<String> refreshTokens, String csrf,
                                            String requestId) throws Exception {
        if (!start.await(10, TimeUnit.SECONDS)) throw new AssertionError("logout start barrier timed out");
        String refreshCookies = String.join("; ", refreshTokens.stream()
                .map(refresh -> "MW_REFRESH=" + refresh).toList());
        return send("POST", "/api/auth/logout", null, requestId, null, Map.of(
                "Cookie", refreshCookies + "; XSRF-TOKEN=" + csrf,
                "X-XSRF-TOKEN", csrf,
                "Origin", ALLOWED_ORIGIN));
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

    private SessionPayload login(Credentials user) throws Exception {
        var response = send("POST", "/api/auth/login", loginJson(user.username(), user.password()),
                requestId("login"), null, Map.of());
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactlyInAnyOrder("accessToken", "tokenType", "expiresIn", "user");
        String accessToken = body.get("accessToken") instanceof String value ? value : "";
        assertThat(!accessToken.isBlank()).isTrue();
        assertThat(body.get("tokenType")).isEqualTo("Bearer");
        assertThat(body.get("expiresIn")).isInstanceOf(Number.class);
        assertThat(body.containsKey("refreshToken")).isFalse();
        return new SessionPayload(accessToken, responseCookie(response, "MW_REFRESH"));
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

    private SessionPayload session(HttpResponse<String> response) throws Exception {
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        assertThat(keys(body)).containsExactlyInAnyOrder("accessToken", "tokenType", "expiresIn", "user");
        String accessToken = body.get("accessToken") instanceof String value ? value : "";
        assertThat(!accessToken.isBlank()).isTrue();
        assertThat(body.get("tokenType")).isEqualTo("Bearer");
        assertThat(body.get("expiresIn")).isInstanceOf(Number.class);
        assertThat(body.containsKey("refreshToken")).isFalse();
        return new SessionPayload(accessToken, responseCookie(response, "MW_REFRESH"));
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

    private static List<String> keys(Map<?, ?> body) {
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

    private List<Long> refreshGenerations(Credentials user) throws Exception {
        String sql = "SELECT t.generation FROM " + table("user_session_refresh_tokens")
                + " t JOIN " + table("user_sessions") + " s ON s.id = t.session_id"
                + " JOIN " + table("users") + " u ON u.id = s.user_id"
                + " WHERE u.username = ? ORDER BY t.generation";
        try (var connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, user.username());
            try (var result = statement.executeQuery()) {
                var generations = new ArrayList<Long>();
                while (result.next()) generations.add(result.getLong(1));
                return generations;
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
