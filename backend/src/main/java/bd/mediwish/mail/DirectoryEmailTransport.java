package bd.mediwish.mail;

import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Clock;
import java.util.UUID;

/** Local/test mailbox: only an atomic rename publishes the completed JSON message. */
public final class DirectoryEmailTransport implements EmailTransport {
    private final Path directory;
    private final ObjectMapper json;
    private final Clock clock;

    public DirectoryEmailTransport(Path directory, ObjectMapper json, Clock clock) {
        this.directory = directory;
        this.json = json;
        this.clock = clock;
    }

    @Override
    public void send(EmailMessage message) {
        Path temporary = null;
        try {
            temporary = Files.createTempFile(directory, "mail-", ".tmp");
            Files.write(temporary, json.writeValueAsBytes(message));
            Path target = directory.resolve(clock.millis() + "-" + UUID.randomUUID() + ".json");
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException failure) {
            throw new EmailDeliveryException();
        } finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); }
                catch (IOException cleanupFailure) { /* The run-owned capture directory is cleaned at teardown. */ }
            }
        }
    }
}
