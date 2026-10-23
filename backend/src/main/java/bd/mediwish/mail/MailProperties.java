package bd.mediwish.mail;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Provider-neutral mail settings; capture adapters are confined to local/test startup. */
@ConfigurationProperties("app.mail")
public record MailProperties(@DefaultValue("disabled") String transport,
                             String captureDirectory) {}
