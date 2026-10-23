package bd.mediwish.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Sends transient mail only after the transaction that authorized it commits. */
@Component
public class AfterCommitMailer {
    private static final Logger LOG = LoggerFactory.getLogger(AfterCommitMailer.class);
    private final EmailTransport transport;
    private final TaskExecutor executor;

    public AfterCommitMailer(EmailTransport transport, @Qualifier("mailExecutor") TaskExecutor executor) {
        this.transport = transport;
        this.executor = executor;
    }

    public void sendAfterCommit(EmailMessage message, Runnable onFailure) {
        if (!TransactionSynchronizationManager.isSynchronizationActive())
            throw new IllegalStateException("Mail requires transaction synchronization");
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    executor.execute(() -> {
                        try {
                            transport.send(message);
                        } catch (RuntimeException failure) {
                            failed(message, onFailure);
                        }
                    });
                } catch (RuntimeException rejected) {
                    failed(message, onFailure);
                }
            }
        });
    }

    private static void failed(EmailMessage message, Runnable onFailure) {
        LOG.warn("mail.failed kind={}", message.kind());
        try {
            onFailure.run();
        } catch (RuntimeException auditUnavailable) {
            // Delivery and its failure audit cannot undo the transaction that already committed.
        }
    }
}
