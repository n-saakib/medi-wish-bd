package bd.mediwish.compatibility;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestDatabase;
import jakarta.persistence.EntityManagerFactory;
import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.util.ClassUtils;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static org.assertj.core.api.Assertions.assertThat;

/** Executes only when the optional compatibility profile supplies both integrations. */
@Tag("integration")
@Tag("compatibility")
@EnabledIf("compatibilityDependenciesPresent")
class DependencyCompatibilityIT {

    private static final String SCHEDULER = "org.jobrunr.scheduling.JobScheduler";
    private static final String STORAGE = "org.jobrunr.storage.StorageProvider";
    private static final String OPEN_API = "org.springdoc.core.service.OpenAPIService";

    static boolean compatibilityDependenciesPresent() {
        var loader = DependencyCompatibilityIT.class.getClassLoader();
        return ClassUtils.isPresent(SCHEDULER, loader) && ClassUtils.isPresent(OPEN_API, loader);
    }

    @Test
    void optionalIntegrationsStartAndRestartAgainstRealPostgresWithoutExposingInternals() throws Exception {
        try (var database = TestDatabase.create()) {
            List<String> initialMigrations;
            try (var context = start(database)) {
                verifyBeansAndRestrictedBehavior(context);
                initialMigrations = migrations(database);
                assertThat(initialMigrations).isNotEmpty();
                assertNoQueuedJobs(database);
            }

            try (var restarted = start(database)) {
                verifyBeansAndRestrictedBehavior(restarted);
                assertThat(migrations(database)).containsExactlyElementsOf(initialMigrations);
                assertNoQueuedJobs(database);
            }
        }
    }

    private static ConfigurableApplicationContext start(TestDatabase database) {
        Map<String, Object> properties = new HashMap<>(database.applicationProperties());
        properties.put("jobrunr.database.type", "sql");
        properties.put("jobrunr.job-scheduler.enabled", "true");
        properties.put("jobrunr.background-job-server.enabled", "false");
        properties.put("jobrunr.dashboard.enabled", "false");
        properties.put("jobrunr.miscellaneous.allow-anonymous-data-usage", "false");
        properties.put("springdoc.api-docs.enabled", "true");
        properties.put("springdoc.swagger-ui.enabled", "false");

        return TestApplication.launch(properties);
    }

    private static void verifyBeansAndRestrictedBehavior(ConfigurableApplicationContext context) throws Exception {
        assertThat(context.getBean(EntityManagerFactory.class).isOpen()).isTrue();
        assertThat(context.getBean(SpringLiquibase.class)).isNotNull();
        assertThat(context.getBean(Class.forName(SCHEDULER))).isNotNull();
        assertThat(context.getBean(Class.forName(STORAGE)).getClass().getName()).containsIgnoringCase("sql");
        assertThat(context.getBeanNamesForType(Class.forName("org.jobrunr.server.BackgroundJobServer"))).isEmpty();
        assertThat(context.getBeanNamesForType(Class.forName("org.jobrunr.dashboard.JobRunrDashboardWebServer"))).isEmpty();

        Object openApiService = context.getBean(Class.forName(OPEN_API));
        Object description = openApiService.getClass().getMethod("build", Locale.class)
                .invoke(openApiService, Locale.ENGLISH);
        assertThat(description).isNotNull();
        assertThat(description.getClass().getName()).isEqualTo("io.swagger.v3.oas.models.OpenAPI");

        Object jobRunrProperties = context.getBean(Class.forName("org.jobrunr.spring.autoconfigure.JobRunrProperties"));
        Object miscellaneous = jobRunrProperties.getClass().getMethod("getMiscellaneous").invoke(jobRunrProperties);
        assertThat(miscellaneous.getClass().getMethod("isAllowAnonymousDataUsage").invoke(miscellaneous)).isEqualTo(false);

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);
        try (var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()) {
            var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v3/api-docs"))
                    .timeout(Duration.ofSeconds(10)).GET().build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            // The production chain denies every route it does not list, before springdoc can answer.
            assertError(response, 401, "AUTHENTICATION_REQUIRED");
        }
    }

    private static List<String> migrations(TestDatabase database) throws SQLException {
        try (Connection connection = database.connect();
             var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT id, author, filename, md5sum FROM "
                     + quotedSchema(database) + ".databasechangelog ORDER BY orderexecuted")) {
            List<String> migrations = new ArrayList<>();
            while (result.next()) {
                migrations.add(result.getString(1) + "|" + result.getString(2) + "|"
                        + result.getString(3) + "|" + result.getString(4));
            }
            return migrations;
        }
    }

    private static void assertNoQueuedJobs(TestDatabase database) throws SQLException {
        try (Connection connection = database.connect();
             var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT count(*) FROM " + quotedSchema(database) + ".jobrunr_jobs")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getLong(1)).isZero();
        }
    }

    private static String quotedSchema(TestDatabase database) {
        assertThat(database.schema()).matches("mw_it_[a-f0-9]{32}");
        return "\"" + database.schema() + "\"";
    }
}
