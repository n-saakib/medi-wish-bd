package bd.mediwish.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Hosted default until a production delivery adapter is configured by a later ticket. */
public final class DisabledEmailTransport implements EmailTransport {
    private static final Logger LOG = LoggerFactory.getLogger(DisabledEmailTransport.class);

    @Override
    public void send(EmailMessage message) {
        LOG.info("mail.skipped kind={}", message.kind());
    }
}
