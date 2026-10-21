package bd.mediwish.health;

import bd.mediwish.MediWishApplication;
import bd.mediwish.testsupport.TestDatabase;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.core.env.MapPropertySource;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;

@Tag("integration")
@Tag("security")
@ExtendWith(OutputCaptureExtension.class)
class ConfigurationIT {
    @Test
    void invalidDatasourceConfigurationFailsBeforeConnectingWithoutPrintingPassword(CapturedOutput output) {
        String secret = "never-log-this-database-password-3fe9";
        Map<String, Object> properties = new HashMap<>(TestDatabase.syntheticAuthProperties());
        properties.put("server.port", "0");
        properties.put("spring.datasource.url", "not-a-jdbc-url");
        properties.put("spring.datasource.username", "synthetic-test-user");
        properties.put("spring.datasource.password", secret);

        assertThatThrownBy(() -> run(properties, "test"))
                .hasRootCauseInstanceOf(IllegalArgumentException.class)
                .hasStackTraceContaining("jdbc")
                .hasStackTraceContaining("url");
        assertThat(output.getAll())
                .contains("Application run failed")
                .doesNotContain(secret)
                .hasSizeLessThan(65536);
    }

    /** With no active profile the hosted rules apply; the datasource is valid, so startup fails on the auth rule itself. */
    @ParameterizedTest(name = "{2}")
    @CsvSource({
            "app.auth.cookie.secure, false, hosted auth cookies must be Secure",
            "app.auth.jwt-secret, bmV2ZXItbG9nLXRoaXMtc2hvcnQta2V5, auth JWT secret must be Base64 of at least 32 bytes"})
    void anInvalidAuthSettingFailsStartupWithAValidDatasource(String property, String value, String rule,
                                                               CapturedOutput output) throws Exception {
        try (var database = TestDatabase.create()) {
            Map<String, Object> properties = new HashMap<>(database.applicationProperties());
            properties.put("app.notification.security.adapter", "disabled");
            properties.put("app.cors.allowed-origins", "https://shop.example.test");
            properties.put("app.auth.cookie.secure", "true");
            properties.put(property, value);

            assertThatThrownBy(() -> run(properties)).hasRootCauseMessage(rule);
            assertThat(output.getAll()).contains("Application run failed").doesNotContain(
                    String.valueOf(properties.get("app.auth.jwt-secret")),
                    String.valueOf(properties.get("spring.datasource.password")));
        }
    }

    @ParameterizedTest
    @CsvSource({
            "app.storage.provider, '', app.storage.provider must be local",
            "app.storage.provider, s3, app.storage.provider must be local",
            "app.storage.local-root, relative, app.storage.local-root must be an absolute path",
            "app.storage.namespace, '', app.storage.namespace must be a valid namespace",
            "app.storage.namespace, Invalid_Name, app.storage.namespace must be a valid namespace",
            "app.storage.namespace, dev-images, test storage namespace must start with test-"})
    void invalidStorageConfigurationRefusesStartupWithoutLeakingValues(String property, String value, String rule,
            CapturedOutput output) throws Exception {
        try (var database = TestDatabase.create()) {
            var properties = new HashMap<>(database.applicationProperties());
            properties.put(property, value);
            assertThatThrownBy(() -> run(properties, "test")).isInstanceOf(IllegalStateException.class).hasMessage(rule);
            assertThat(output.getAll()).doesNotContain(String.valueOf(properties.get("spring.datasource.password")),
                    String.valueOf(properties.get("app.auth.jwt-secret")));
        }
    }

    @Test void localAdapterRefusesHostedProfiles(CapturedOutput output) throws Exception {
        try (var database = TestDatabase.create()) {
            var properties = new HashMap<>(database.applicationProperties());
            properties.put("app.notification.security.adapter", "disabled");
            properties.put("app.auth.cookie.secure", "true");
            properties.put("app.cors.allowed-origins", "https://shop.example.test");
            properties.put("app.storage.namespace", "prod-check");
            assertThatThrownBy(() -> run(properties))
                    .isInstanceOf(IllegalStateException.class).hasMessage(bd.mediwish.storage.StorageConfiguration.LOCAL_PROFILE_RULE);
            assertThat(output.getAll()).doesNotContain(String.valueOf(properties.get("spring.datasource.password")));
        }
    }
    private static void run(Map<String, Object> properties, String... profiles) {
        var application = new SpringApplication(MediWishApplication.class);
        application.setAdditionalProfiles(profiles);
        application.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("configuration-test", properties)));
        application.run().close();
    }
}
