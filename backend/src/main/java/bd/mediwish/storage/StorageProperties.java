package bd.mediwish.storage;
import org.springframework.boot.context.properties.ConfigurationProperties;
@ConfigurationProperties("app.storage")
public record StorageProperties(String provider, String localRoot, String namespace) {}
