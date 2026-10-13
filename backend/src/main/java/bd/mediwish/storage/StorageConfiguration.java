package bd.mediwish.storage;

import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import java.nio.file.Path;
import java.nio.file.InvalidPathException;
import java.util.Arrays;
import java.util.List;

@Configuration
@EnableConfigurationProperties(StorageProperties.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class StorageConfiguration {
    public static final String PROVIDER_RULE = "app.storage.provider must be local";
    public static final String ROOT_RULE = "app.storage.local-root must be an absolute path";
    public static final String NAMESPACE_RULE = "app.storage.namespace must be a valid namespace";
    public static final String TEST_NAMESPACE_RULE = "test storage namespace must start with test-";
    public static final String NON_TEST_NAMESPACE_RULE = "non-test storage namespace must not start with test-";
    public static final String LOCAL_PROFILE_RULE = "local storage requires only local or test active profiles";

    @Bean ObjectStorage objectStorage(StorageProperties properties) {
        Path root;
        try { root = Path.of(properties.localRoot() == null ? "" : properties.localRoot()); }
        catch (InvalidPathException invalid) { root = Path.of(""); }
        return new LocalObjectStorage(root, properties.namespace());
    }
    @Bean SmartInitializingSingleton storageGuard(StorageProperties properties, Environment environment) {
        return () -> validate(properties, environment.getActiveProfiles());
    }
    static void validate(StorageProperties properties, String... profiles) {
        if (!"local".equals(properties.provider())) throw new IllegalStateException(PROVIDER_RULE);
        try {
            if (properties.localRoot() == null || properties.localRoot().isBlank() || !Path.of(properties.localRoot()).isAbsolute()) throw new IllegalStateException(ROOT_RULE);
        } catch (InvalidPathException invalid) { throw new IllegalStateException(ROOT_RULE); }
        String namespace = properties.namespace();
        if (namespace == null || !namespace.matches("[a-z0-9][a-z0-9-]{0,62}")) throw new IllegalStateException(NAMESPACE_RULE);
        boolean test = Arrays.asList(profiles).contains("test");
        if (test && !namespace.startsWith("test-")) throw new IllegalStateException(TEST_NAMESPACE_RULE);
        if (!test && namespace.startsWith("test-")) throw new IllegalStateException(NON_TEST_NAMESPACE_RULE);
        if (profiles.length == 0 || Arrays.stream(profiles).anyMatch(profile -> !List.of("local", "test").contains(profile))) throw new IllegalStateException(LOCAL_PROFILE_RULE);
    }
}
