package bd.mediwish.mail;

import org.junit.jupiter.api.Test;
import java.time.Duration;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InMemoryEmailTransportTest {
    private static final EmailMessage MESSAGE = new EmailMessage("synthetic@example.test", "Synthetic subject",
            "Synthetic body", EmailKind.EMAIL_CHANGED);

    @Test
    void capturesSnapshotsAndWaitsForTheMatchingMailWithoutPolling() throws Exception {
        var transport = new InMemoryEmailTransport();
        assertThatThrownBy(() -> transport.awaitMessage(mail -> true, Duration.ZERO))
                .isInstanceOf(IllegalStateException.class);
        transport.send(MESSAGE);
        assertThat(transport.awaitMessage(mail -> mail.kind() == EmailKind.EMAIL_CHANGED, Duration.ofSeconds(1)))
                .isEqualTo(MESSAGE);
        var snapshot = transport.messages();
        transport.clear();
        assertThat(transport.messages()).isEmpty();
        assertThat(snapshot).containsExactly(MESSAGE);
    }

    @Test
    void controlledFailuresCaptureNothingAndStopAfterTheRequestedNumberOfSends() {
        var transport = new InMemoryEmailTransport();
        transport.failNext(2);
        assertThatThrownBy(() -> transport.send(MESSAGE)).isInstanceOf(EmailDeliveryException.class)
                .hasMessage(null).hasCause(null);
        assertThatThrownBy(() -> transport.send(MESSAGE)).isInstanceOf(EmailDeliveryException.class);
        assertThat(transport.messages()).isEmpty();
        transport.send(MESSAGE);
        assertThat(transport.messages()).containsExactly(MESSAGE);
    }
}
