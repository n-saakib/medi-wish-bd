package bd.mediwish.health;

import bd.mediwish.MediWishApplication;
import jakarta.persistence.EntityManagerFactory;
import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.*;

@Tag("integration")
@Tag("regression")
@ExtendWith(OutputCaptureExtension.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class HealthIT {
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final JsonMapper json = JsonMapper.builder().build();
    private TestDatabase database;
    private DisconnectableTcpProxy proxy;
    private ConfigurableApplicationContext application;
    private URI base;

    @BeforeAll
    void startAgainstIsolatedPostgresSchema() throws Exception {
        database = TestDatabase.create();
        proxy = new DisconnectableTcpProxy(database.host(), database.port());
        startApplication();
    }

    private void startApplication() {
        var launcher = new SpringApplication(MediWishApplication.class);
        launcher.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("isolated-integration-database", database.applicationProperties(proxy.port()))));
        application = launcher.run();
        base = URI.create("http://127.0.0.1:" + application.getEnvironment().getRequiredProperty("local.server.port"));
    }

    @AfterAll
    void closeOnlyResourcesOwnedByThisRun() throws Exception {
        try {
            if (application != null) application.close();
        } finally {
            try {
                if (proxy != null) proxy.close();
            } finally {
                if (database != null) database.close();
                client.close();
            }
        }
    }

    @Test
    @Order(1)
    @Tag("sanity")
    @Tag("contract")
    void startedApplicationHasMinimalLiveAndReadyResponsesAndActualJpaAndLiquibase() throws Exception {
        assertHealth("liveness", 200, "UP");
        assertHealth("readiness", 200, "UP");
        assertThat(application.getBean(EntityManagerFactory.class).isOpen()).isTrue();
        assertThat(application.getBean(SpringLiquibase.class)).isNotNull();
        assertThat(scalar("SELECT count(*) FROM " + database.schema() + ".databasechangelog")).isPositive();
    }

    @Test
    @Order(2)
    @Tag("security")
    void managementAndUnknownRoutesReturnBoundedErrorsWithoutRequestSecrets(CapturedOutput output) throws Exception {
        String secret = "PRIVATE_password_OTP_token_medicine_search_9f7";
        Set<String> responseIds = new HashSet<>();
        for (String route : new String[]{"/actuator/env", "/actuator/configprops", "/actuator/metrics",
                "/actuator/heapdump", "/actuator/loggers", "/actuator/mappings", "/actuator/health",
                "/actuator/health/readiness/db", "/v3/api-docs", "/dashboard", "/missing/" + secret}) {
            var response = get(route + "?search=" + secret, "privacy-check-01");
            assertThat(response.statusCode()).isEqualTo(401);
            Map<?, ?> error = json.readValue(response.body(), Map.class);
            assertThat(error.keySet().stream().map(Object::toString).toList())
                    .containsExactlyInAnyOrder("code", "message", "requestId");
            String responseId = response.headers().firstValue("X-Request-Id").orElseThrow();
            assertThat(responseId)
                    .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                    .isNotEqualTo("privacy-check-01");
            assertThat(error.get("requestId")).isEqualTo(responseId);
            assertThat(responseIds.add(responseId)).isTrue();
            assertThat(error.get("message")).isInstanceOf(String.class);
            assertThat(response.body()).hasSizeLessThan(512).doesNotContain(secret, "Exception", "jdbc:", "password=");
        }
        Set<String> expectedLoggedIds = Set.copyOf(responseIds);
        var post = client.send(HttpRequest.newBuilder(base.resolve("/actuator/health/liveness"))
                .timeout(Duration.ofSeconds(10)).header("X-Request-Id", "post-health-01")
                .POST(HttpRequest.BodyPublishers.ofString(secret)).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(post.statusCode()).isEqualTo(403);
        Map<?, ?> postError = json.readValue(post.body(), Map.class);
        assertThat(postError.keySet().stream().map(Object::toString).toList())
                .containsExactlyInAnyOrder("code", "message", "requestId");
        String postRequestId = post.headers().firstValue("X-Request-Id").orElseThrow();
        assertThat(postError.get("code")).isEqualTo("ACCESS_DENIED");
        assertThat(postError.get("message")).isEqualTo("Access is denied.");
        assertThat(postError.get("requestId")).isEqualTo(postRequestId);
        assertThat(post.body()).hasSizeLessThan(512).doesNotContain(secret, "Exception", "jdbc:", "password=");
        assertThat(postRequestId)
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                .isNotEqualTo("post-health-01");
        assertThat(responseIds.add(postRequestId)).isTrue();
        assertThat(responseIds).hasSize(12);

        var responseLogs = output.getAll().lines()
                .filter(line -> line.contains("\"logger\":\"bd.mediwish.web.RequestCorrelationFilter\""))
                .filter(line -> line.contains("\"message\":\"HTTP response status=401\""))
                .filter(line -> expectedLoggedIds.stream()
                        .anyMatch(id -> line.contains("\"requestId\":\"" + id + "\"")))
                .toList();
        assertThat(responseLogs).hasSize(11);
        Set<String> loggedIds = new HashSet<>();
        for (String line : responseLogs) {
            Map<?, ?> log = json.readValue(line, Map.class);
            String loggedId = String.valueOf(log.get("requestId"));
            assertThat(loggedId)
                    .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
            assertThat(loggedIds.add(loggedId)).isTrue();
            assertThat(String.valueOf(log.get("message"))).isEqualTo("HTTP response status=401");
        }
        assertThat(loggedIds).containsExactlyInAnyOrderElementsOf(expectedLoggedIds);

        var deniedResponseLogs = output.getAll().lines()
                .filter(line -> line.contains("\"logger\":\"bd.mediwish.web.RequestCorrelationFilter\""))
                .filter(line -> line.contains("\"message\":\"HTTP response status=403\""))
                .filter(line -> line.contains("\"requestId\":\"" + postRequestId + "\""))
                .toList();
        assertThat(deniedResponseLogs).hasSize(1);
        Map<?, ?> deniedLog = json.readValue(deniedResponseLogs.get(0), Map.class);
        assertThat(deniedLog.get("requestId")).isEqualTo(postRequestId);
        assertThat(deniedLog.get("message")).isEqualTo("HTTP response status=403");
        assertThat(output.getAll()).doesNotContain("privacy-check-01", "post-health-01");
        assertThat(output.getAll()).doesNotContain(secret);
    }

    @Test
    @Order(3)
    @Tag("security")
    void untrustedCorrelationIdIsReplacedWithoutEchoingOrLoggingIt(CapturedOutput output) throws Exception {
        String invalidId = "private-value!".repeat(20);
        var response = get("/actuator/health/liveness", invalidId);
        assertThat(response.statusCode()).isEqualTo(200);
        String returnedId = response.headers().firstValue("X-Request-Id").orElseThrow();
        assertThat(returnedId)
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                .isNotEqualTo(invalidId);
        assertThat(response.body()).doesNotContain(invalidId);
        assertThat(output.getAll()).doesNotContain(invalidId);
    }

    @Test
    @Order(4)
    void concurrentPublicChecksKeepRequestCorrelationIndependent() throws Exception {
        Set<String> responseIds = new HashSet<>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = new ArrayList<java.util.concurrent.Future<HttpResponse<String>>>();
            for (int i = 0; i < 8; i++) {
                final String requestId = "concurrent-" + i;
                futures.add(executor.submit(() -> get("/actuator/health/readiness", requestId)));
            }
            for (int i = 0; i < futures.size(); i++) {
                var response = futures.get(i).get(10, java.util.concurrent.TimeUnit.SECONDS);
                assertThat(response.statusCode()).isEqualTo(200);
                String responseId = response.headers().firstValue("X-Request-Id").orElseThrow();
                assertThat(responseId)
                        .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                        .isNotEqualTo("concurrent-" + i);
                assertThat(responseIds.add(responseId)).isTrue();
                assertThat(json.readValue(response.body(), Map.class)).isEqualTo(Map.of("status", "UP"));
            }
        }
        assertThat(responseIds).hasSize(8);
    }

    @Test
    @Order(5)
    @Tag("recovery")
    void databaseLossAffectsOnlyReadinessAndServiceRecoversWithoutProcessRestart() throws Exception {
        proxy.disconnect();
        try {
            long started = System.nanoTime();
            assertHealth("readiness", 503, "DOWN");
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(8));
            assertHealth("liveness", 200, "UP");
        } finally {
            proxy.reconnect();
        }
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        HttpResponse<String> recovered;
        do {
            recovered = get("/actuator/health/readiness", "recovery-check-01");
            if (recovered.statusCode() == 200) break;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        assertThat(recovered.statusCode()).isEqualTo(200);
        assertThat(json.readValue(recovered.body(), Map.class)).isEqualTo(Map.of("status", "UP"));
        assertHealth("liveness", 200, "UP");
    }

    @Test
    @Order(6)
    @Tag("migration")
    void restartKeepsExistingDataAndDoesNotReapplyMigration() throws Exception {
        long changes = scalar("SELECT count(*) FROM " + database.schema() + ".databasechangelog");
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE " + database.schema() + ".retention_probe (id integer PRIMARY KEY, value text NOT NULL)");
            statement.execute("INSERT INTO " + database.schema() + ".retention_probe VALUES (1, 'preserve-through-restart')");
        }
        application.close();
        application = null;
        startApplication();
        assertHealth("liveness", 200, "UP");
        assertHealth("readiness", 200, "UP");
        assertThat(scalar("SELECT count(*) FROM " + database.schema() + ".databasechangelog")).isEqualTo(changes);
        assertThat(scalar("SELECT count(*) FROM " + database.schema()
                + ".retention_probe WHERE id = 1 AND value = 'preserve-through-restart'")).isEqualTo(1);
    }

    private long scalar(String query) throws Exception {
        try (var connection = database.connect(); var statement = connection.createStatement(); var result = statement.executeQuery(query)) {
            result.next();
            return result.getLong(1);
        }
    }

    private void assertHealth(String group, int expectedStatus, String expectedHealth) throws Exception {
        var response = get("/actuator/health/" + group, "health-check-01");
        assertThat(response.statusCode()).isEqualTo(expectedStatus);
        assertThat(json.readValue(response.body(), Map.class)).isEqualTo(Map.of("status", expectedHealth));
        assertThat(response.headers().firstValue("content-type").orElse("")).contains("application/").contains("json");
        assertThat(response.headers().firstValue("cache-control").orElse("")).contains("no-store");
        assertThat(response.headers().firstValue("X-Request-Id").orElseThrow())
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                .isNotEqualTo("health-check-01");
    }

    private HttpResponse<String> get(String path, String requestId) throws Exception {
        return client.send(HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(10))
                .header("X-Request-Id", requestId).GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
