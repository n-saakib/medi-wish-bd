package bd.mediwish.notification;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import java.util.Arrays;
import java.util.List;

@Configuration
@EnableConfigurationProperties(NotificationProperties.class)
public class NotificationConfiguration {
    public static final String CAPTURE_PROFILE_RULE = "capture security notices require only local or test active profiles";

    @Bean SecurityNotifier securityNotifier(NotificationProperties properties, Environment environment) {
        if (properties.adapter().equals("disabled")) return new DisabledSecurityNotifier();
        String[] profiles = environment.getActiveProfiles();
        if (profiles.length == 0 || Arrays.stream(profiles).anyMatch(profile -> !List.of("local", "test").contains(profile))) {
            throw new IllegalStateException(CAPTURE_PROFILE_RULE);
        }
        return new CaptureSecurityNotifier();
    }
}
