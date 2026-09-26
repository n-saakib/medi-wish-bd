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
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
@Tag("regression")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SessionRestartIT {
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
        startApplication();
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
    void activeAndRevokedSessionsAndReplayStateSurviveApplicationRestart() throws Exception {
        Credentials user = uniqueUser();
        register(user);
        SessionPayload initial = login(user);
        SessionPayload revoked = login(user);
        assertThat(send("GET", "/api/user/me", null, requestId("before-restart"),
                "Bearer " + initial.accessToken(), Map.of()).statusCode()).isEqualTo(200);

        ReceivedCookie csrfBeforeRestart = csrfCookie();
        assertThat(logout(revoked.refreshCookie().value(), csrfBeforeRestart.value()).statusCode()).isEqualTo(204);
        assertThat(send("GET", "/api/user/me", null, requestId("revoked-before-restart"),
                "Bearer " + revoked.accessToken(), Map.of()).statusCode()).isEqualTo(401);

        application.close();
        startApplication();

        var afterRestart = send("GET", "/api/user/me", null, requestId("after-restart"),
                "Bearer " + initial.accessToken(), Map.of());
        assertThat(afterRestart.statusCode()).isEqualTo(200);

        var revokedAccess = send("GET", "/api/user/me", null, requestId("revoked-after-restart"),
                "Bearer " + revoked.accessToken(), Map.of());
        assertThat(revokedAccess.statusCode()).isEqualTo(401);

        ReceivedCookie csrf = csrfCookie();
        assertError(refresh(revoked.refreshCookie().value(), csrf.value()), 401, "AUTHENTICATION_REQUIRED");
        SessionPayload rotated = session(refresh(initial.refreshCookie().value(), csrf.value()));
        assertThat(rotated.refreshCookie().value()).isNotEqualTo(initial.refreshCookie().value());

        var replay = refresh(initial.refreshCookie().value(), csrf.value());
        assertError(replay, 401, "AUTHENTICATION_REQUIRED");
        var replayRevokedAccess = send("GET", "/api/user/me", null, requestId("replay-access"),
                "Bearer " + rotated.accessToken(), Map.of());
        assertThat(replayRevokedAccess.statusCode()).isEqualTo(401);
    }

    private void startApplication() {
        var properties = new HashMap<>(database.applicationProperties());
        properties.put("app.auth.access-token-lifetime", "PT5M");
        var launcher = new SpringApplication(MediWishApplication.class);
        launcher.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("isolated-session-restart-" + UUID.randomUUID(), properties)));
        application = launcher.run();
        base = URI.create("http://127.0.0.1:"
                + application.getEnvironment().getRequiredProperty("local.server.port"));
    }

    private void register(Credentials user) throws Exception {
        var response = send("POST", "/api/auth/register", registrationJson(user), requestId("register"),
                null, Map.of());
        assertThat(response.statusCode()).isEqualTo(201);
    }

    private SessionPayload login(Credentials user) throws Exception {
        var response = send("POST", "/api/auth/login", loginJson(user.username(), user.password()),
                requestId("login"), null, Map.of());
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        String accessToken = body.get("accessToken") instanceof String value ? value : "";
        assertThat(accessToken).isNotBlank();
        return new SessionPayload(accessToken, responseCookie(response, "MW_REFRESH"));
    }

    private ReceivedCookie csrfCookie() throws Exception {
        var response = send("GET", "/api/auth/csrf", null, requestId("csrf"), null, Map.of());
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        ReceivedCookie cookie = responseCookie(response, "XSRF-TOKEN");
        assertThat(body.get("csrfToken")).isEqualTo(cookie.value());
        return cookie;
    }

    private HttpResponse<String> refresh(String refresh, String csrf) throws Exception {
        return send("POST", "/api/auth/refresh", null, requestId("refresh"), null, Map.of(
                "Cookie", "MW_REFRESH=" + refresh + "; XSRF-TOKEN=" + csrf,
                "X-XSRF-TOKEN", csrf,
                "Origin", ALLOWED_ORIGIN));
    }

    private HttpResponse<String> logout(String refresh, String csrf) throws Exception {
        return send("POST", "/api/auth/logout", null, requestId("logout"), null, Map.of(
                "Cookie", "MW_REFRESH=" + refresh + "; XSRF-TOKEN=" + csrf,
                "X-XSRF-TOKEN", csrf,
                "Origin", ALLOWED_ORIGIN));
    }

    private SessionPayload session(HttpResponse<String> response) throws Exception {
        assertThat(response.statusCode()).isEqualTo(200);
        Map<?, ?> body = json(response);
        String accessToken = body.get("accessToken") instanceof String value ? value : "";
        assertThat(accessToken).isNotBlank();
        return new SessionPayload(accessToken, responseCookie(response, "MW_REFRESH"));
    }

    private void assertError(HttpResponse<String> response, int status, String code) throws Exception {
        assertThat(response.statusCode()).isEqualTo(status);
        Map<?, ?> body = json(response);
        assertThat(body.get("code")).isEqualTo(code);
        assertThat(body.keySet().stream().map(Object::toString).toList())
                .containsExactlyInAnyOrder("code", "message", "requestId");
        assertThat(response.body()).doesNotContain("accessToken", "refreshToken");
    }

    private Map<?, ?> json(HttpResponse<String> response) throws Exception {
        return JSON.readValue(response.body(), Map.class);
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
        String value = header.substring(prefix.length()).split(";", 2)[0];
        return new ReceivedCookie(value);
    }

    private static Credentials uniqueUser() {
        String suffix = UUID.randomUUID().toString().replace("-", "");
        return new Credentials("restart_" + suffix.substring(0, 12),
                "017" + suffix.substring(12, 21),
                "restart." + suffix.substring(20, 32) + "@example.test",
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

    private record ReceivedCookie(String value) {}

    private record SessionPayload(String accessToken, ReceivedCookie refreshCookie) {}
}
