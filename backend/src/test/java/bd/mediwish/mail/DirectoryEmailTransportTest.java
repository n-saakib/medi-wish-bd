package bd.mediwish.mail;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import static org.assertj.core.api.Assertions.assertThat;

class DirectoryEmailTransportTest {
    @TempDir Path directory;

    @Test
    void publishesCompleteJsonMailWithUniqueNamesAndNoTemporaryFiles() throws Exception {
        var json = JsonMapper.builder().build();
        var clock = Clock.fixed(Instant.parse("2026-10-19T00:00:00Z"), ZoneOffset.UTC);
        var transport = new DirectoryEmailTransport(directory, json, clock);
        var message = new EmailMessage("synthetic@example.test", "Synthetic subject", "Synthetic body 042917",
                EmailKind.PASSWORD_RESET_CODE);
        transport.send(message);
        transport.send(message);
        try (var entries = Files.list(directory)) {
            var files = entries.toList();
            assertThat(files).hasSize(2);
            for (Path file : files) {
                assertThat(file.getFileName().toString()).matches("[0-9]+-[0-9a-f-]{36}\\.json");
                var body = json.readTree(Files.readString(file));
                assertThat(java.util.Set.copyOf(body.propertyNames()))
                        .containsExactlyInAnyOrder("to", "subject", "body", "kind");
                // Boolean operands keep controlled mailbox contents out of assertion diagnostics.
                assertThat(body.get("to").stringValue().equals(message.to())).isTrue();
                assertThat(body.get("subject").stringValue().equals(message.subject())).isTrue();
                assertThat(body.get("body").stringValue().equals(message.body())).isTrue();
                assertThat(body.get("kind").stringValue()).isEqualTo("PASSWORD_RESET_CODE");
            }
        }
    }
}
