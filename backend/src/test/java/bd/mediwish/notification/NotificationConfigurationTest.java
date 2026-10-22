package bd.mediwish.notification;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import java.time.Duration;
import static org.assertj.core.api.Assertions.*;

class NotificationConfigurationTest {
    private final NotificationConfiguration configuration = new NotificationConfiguration();

    @Test void defaultsDisableDelivery() {
        var properties = new NotificationProperties(null, null);
        assertThat(properties.adapter()).isEqualTo("disabled");
        assertThat(properties.timeout()).isEqualTo(Duration.ofSeconds(5));
        assertThat(configuration.securityNotifier(properties, new MockEnvironment()).send(new SecurityNotice("01700000000", "notice")))
                .isEqualTo(NoticeOutcome.NOT_CONFIGURED);
    }

    @Test void captureRequiresOnlyExplicitLocalOrTestProfiles() {
        var properties = new NotificationProperties("capture", null);
        for (String[] profiles : new String[][]{{}, {"prod"}, {"local", "prod"}}) {
            var environment = new MockEnvironment();
            environment.setActiveProfiles(profiles);
            assertThatThrownBy(() -> configuration.securityNotifier(properties, environment))
                    .isInstanceOf(IllegalStateException.class).hasMessage(NotificationConfiguration.CAPTURE_PROFILE_RULE);
        }
        for (String[] profiles : new String[][]{{"test"}, {"local"}, {"local", "test"}}) {
            var environment = new MockEnvironment();
            environment.setActiveProfiles(profiles);
            assertThat(configuration.securityNotifier(properties, environment)).isInstanceOf(CaptureSecurityNotifier.class);
        }
    }

    @Test void invalidAdapterAndOutOfRangeTimeoutAreRejected() {
        assertThatThrownBy(() -> new NotificationProperties("sms", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new NotificationProperties(null, Duration.ofMillis(999))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new NotificationProperties(null, Duration.ofMillis(5001))).isInstanceOf(IllegalArgumentException.class);
        assertThat(new NotificationProperties(null, Duration.ofSeconds(1)).timeout()).isEqualTo(Duration.ofSeconds(1));
        assertThat(new NotificationProperties(null, Duration.ofSeconds(5)).timeout()).isEqualTo(Duration.ofSeconds(5));
    }
}
