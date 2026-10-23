package bd.mediwish.notification;

import org.springframework.boot.context.properties.ConfigurationProperties;
import java.time.Duration;

@ConfigurationProperties("app.notification.security")
public record NotificationProperties(String adapter, Duration timeout) {
    public NotificationProperties {
        if (adapter == null) adapter = "disabled";
        if (timeout == null) timeout = Duration.ofSeconds(5);
        if (!adapter.equals("disabled") && !adapter.equals("capture")) {
            throw new IllegalArgumentException("app.notification.security.adapter must be disabled or capture");
        }
        if (timeout.compareTo(Duration.ofSeconds(1)) < 0 || timeout.compareTo(Duration.ofSeconds(5)) > 0) {
            throw new IllegalArgumentException("app.notification.security.timeout must be between 1 and 5 seconds");
        }
    }
}
