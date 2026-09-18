package bd.mediwish.user;

import bd.mediwish.MediWishApplication;
import bd.mediwish.health.TestDatabase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
@Tag("regression")
@Tag("security")
class UserIT {
    private static final String PASSWORD = "a-very-long-password";
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final HttpClient CLIENT = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private static TestDatabase database;
    private static ConfigurableApplicationContext application;
    private static URI base;

    @BeforeAll
    static void startAgainstIsolatedPostgresSchema() throws Exception {
        database = TestDatabase.create();
        var launcher = new SpringApplication(MediWishApplication.class);
        launcher.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("isolated-integration-database", database.applicationProperties())));
        application = launcher.run();
        base = URI.create("http://127.0.0.1:" + application.getEnvironment().getRequiredProperty("local.server.port"));
    }

    @AfterAll
    static void closeOnlyResourcesOwnedByThisRun() throws Exception {
        try {
            if (application != null) application.close();
        } finally {
            if (database != null) database.close();
            CLIENT.close();
        }
    }

    @Test
    void registersUserAndAuthorizesOnlyTheAuthenticatedUserProfile() throws Exception {
        String username = uniqueUsername("alice");
        String request = """
                {"username":"%s","mobile":"01700000000","email":"alice@example.com","password":"a-very-long-password","role":"ADMIN"}
                """.formatted(username);
        var registered = send("POST", "/api/auth/register", request, "register-it-01", null);

        assertThat(registered.statusCode()).isEqualTo(201);
        assertThat(registered.headers().firstValue("X-Request-ID")).contains("register-it-01");
        assertThat(registered.body()).contains("\"username\":\"" + username + "\"", "\"mobileVerificationDeferred\":true")
                .doesNotContain("password", "passwordHash", "role", "ADMIN", PASSWORD);

        var anonymous = send("GET", "/api/user/me", null, "profile-it-01", null);
        assertThat(anonymous.statusCode()).isEqualTo(401);
        assertThat(anonymous.headers().firstValue("WWW-Authenticate"))
                .hasValueSatisfying(value -> assertThat(value).contains("Basic"));
        assertThat(JSON.readValue(anonymous.body(), Map.class).keySet())
                .containsExactlyInAnyOrder("code", "message", "requestId");

        var profile = send("GET", "/api/user/me", null, "profile-it-02", basic(" " + username.toUpperCase() + " ", PASSWORD));
        assertThat(profile.statusCode()).isEqualTo(200);
        assertThat(profile.body()).contains("\"username\":\"" + username + "\"", "\"mobileVerified\":false")
                .doesNotContain(PASSWORD, "passwordHash");

        var wrongPassword = send("GET", "/api/user/me", null, "profile-it-03", basic(username, "wrong-password"));
        assertThat(wrongPassword.statusCode()).isEqualTo(401);

        var staffAttempt = send("GET", "/api/admin", null, "profile-it-04", basic(" " + username.toUpperCase() + " ", PASSWORD));
        assertThat(staffAttempt.statusCode()).isEqualTo(403);
        assertThat(staffAttempt.body()).contains("ACCESS_DENIED").doesNotContain(PASSWORD);
    }

    @Test
    void duplicateUserAndAllowedBrowserPreflightHaveBoundedOutcomes() throws Exception {
        String username = uniqueUsername("duplicate");
        String request = """
                {"username":"%s","mobile":"01700000001","password":"a-very-long-password"}
                """.formatted(username);
        assertThat(send("POST", "/api/auth/register", request, "duplicate-it-01", null).statusCode()).isEqualTo(201);
        var duplicate = send("POST", "/api/auth/register", request, "duplicate-it-02", null);
        assertThat(duplicate.statusCode()).isEqualTo(409);
        assertThat(duplicate.body()).contains("DUPLICATE_USER").doesNotContain(PASSWORD);

        var preflight = HttpRequest.newBuilder(base.resolve("/api/user/me"))
                .timeout(Duration.ofSeconds(10)).header("Origin", "http://127.0.0.1:3000")
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "authorization")
                .header("X-Request-ID", "cors-it-01").method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
        var cors = CLIENT.send(preflight, HttpResponse.BodyHandlers.ofString());
        assertThat(cors.statusCode()).isIn(200, 204);
        assertThat(cors.headers().firstValue("Access-Control-Allow-Origin")).contains("http://127.0.0.1:3000");
    }

    @Test
    void concurrentRegistrationUsesDatabaseUniqueness() throws Exception {
        String username = uniqueUsername("race");
        String request = """
                {"username":"%s","mobile":"01700000002","password":"a-very-long-password"}
                """.formatted(username);
        var start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> {
                start.await();
                return send("POST", "/api/auth/register", request, "race-it-01", null);
            });
            var second = executor.submit(() -> {
                start.await();
                return send("POST", "/api/auth/register", request, "race-it-02", null);
            });
            start.countDown();
            var responses = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
            assertThat(responses.stream().map(HttpResponse::statusCode).sorted().toList())
                    .containsExactly(201, 409);
            var conflict = responses.get(0).statusCode() == 409 ? responses.get(0) : responses.get(1);
            assertThat(conflict.body()).contains("DUPLICATE_USER").doesNotContain(PASSWORD);
        }
    }

    private static HttpResponse<String> send(String method, String path, String body, String requestId, String authorization)
            throws Exception {
        var builder = HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(10))
                .header("X-Request-ID", requestId).header("Content-Type", "application/json");
        if (authorization != null) builder.header("Authorization", authorization);
        var publisher = body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body);
        return CLIENT.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString());
    }

    private static String basic(String username, String password) {
        return "Basic " + Base64.getEncoder().encodeToString((username + ":" + password)
                .getBytes(StandardCharsets.UTF_8));
    }

    private static String uniqueUsername(String prefix) {
        return prefix + "_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }
}
