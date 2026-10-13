package bd.mediwish.storage;
import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.*;
class StorageConfigurationTest {
    private final String root=Path.of("target").toAbsolutePath().toString();
    @Test void namespaceAndProfilesAreValidatedWithoutProvisioningStorage() {
        StorageConfiguration.validate(new StorageProperties("local",root,"test-unit"),"test");
        assertThatThrownBy(() -> StorageConfiguration.validate(new StorageProperties("local",root,"prod-check")))
            .hasMessage(StorageConfiguration.LOCAL_PROFILE_RULE);
        assertThatThrownBy(() -> StorageConfiguration.validate(new StorageProperties("local",root,"prod-check"),"test"))
            .hasMessage(StorageConfiguration.TEST_NAMESPACE_RULE);
        assertThatThrownBy(() -> StorageConfiguration.validate(new StorageProperties("local",root,"test-unit"),"local"))
            .hasMessage(StorageConfiguration.NON_TEST_NAMESPACE_RULE);
        assertThatThrownBy(() -> StorageConfiguration.validate(new StorageProperties("s3",root,"prod-check"),"local"))
            .hasMessage(StorageConfiguration.PROVIDER_RULE);
        assertThatThrownBy(() -> StorageConfiguration.validate(new StorageProperties("local","relative","prod-check"),"local"))
            .hasMessage(StorageConfiguration.ROOT_RULE);
        assertThatThrownBy(() -> StorageConfiguration.validate(new StorageProperties("local",root,"../escape"),"local"))
            .hasMessage(StorageConfiguration.NAMESPACE_RULE);
    }
}
