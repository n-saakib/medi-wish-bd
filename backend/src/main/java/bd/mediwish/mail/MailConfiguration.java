package bd.mediwish.mail;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.core.env.Environment;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.time.Clock;
import java.util.Arrays;

/** Mail is available to web and operator startup; the hosted default sends nothing. */
@Configuration
@EnableConfigurationProperties(MailProperties.class)
public class MailConfiguration {
    public static final String TRANSPORT_RULE = "app.mail.transport must be disabled, memory or directory";

    public static final String LOCAL_PROFILE_RULE = "app.mail.transport requires only local or test active profiles";
    public static final String DIRECTORY_RULE = "app.mail.capture-directory must be a writable directory";

    @Bean
    EmailTransport emailTransport(MailProperties properties, Environment environment, ObjectMapper json, Clock clock) {
        return switch (properties.transport()) {
            case "disabled" -> new DisabledEmailTransport();
            case "memory", "directory" -> {
                String[] profiles = environment.getActiveProfiles();
                if (profiles.length == 0 || Arrays.stream(profiles).anyMatch(profile -> !profile.equals("local") && !profile.equals("test")))
                    throw new IllegalStateException(LOCAL_PROFILE_RULE);
                if (properties.transport().equals("memory")) yield new InMemoryEmailTransport();
                Path directory;
                try {
                    if (properties.captureDirectory() == null || properties.captureDirectory().isBlank())
                        throw new IllegalStateException(DIRECTORY_RULE);
                    directory = Path.of(properties.captureDirectory());
                } catch (InvalidPathException invalid) {
                    throw new IllegalStateException(DIRECTORY_RULE);
                }
                if (!Files.isDirectory(directory) || !Files.isWritable(directory)) throw new IllegalStateException(DIRECTORY_RULE);
                yield new DirectoryEmailTransport(directory, json, clock);
            }
            default -> throw new IllegalStateException(TRANSPORT_RULE);
        };
    }

    @Bean
    ThreadPoolTaskExecutor mailExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("mail-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        return executor;
    }
}
