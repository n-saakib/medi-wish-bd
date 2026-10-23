package bd.mediwish.mail;

@FunctionalInterface
public interface EmailTransport {
    void send(EmailMessage message);
}
