package bd.mediwish.health;

import bd.mediwish.MediWishApplication;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
        var application = new SpringApplication(MediWishApplication.class);
        Map<String, Object> properties = new HashMap<>(TestDatabase.syntheticAuthProperties());
        properties.put("server.port", "0");
        properties.put("spring.datasource.url", "not-a-jdbc-url");
        properties.put("spring.datasource.username", "synthetic-test-user");
        properties.put("spring.datasource.password", secret);
        application.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("invalid-test-configuration", properties)));

        assertThatThrownBy(application::run)
                .hasRootCauseInstanceOf(IllegalArgumentException.class)
                .hasStackTraceContaining("jdbc")
                .hasStackTraceContaining("url");
        assertThat(output.getAll())
                .contains("Application run failed")
                .doesNotContain(secret)
                .hasSizeLessThan(65536);
    }
}
