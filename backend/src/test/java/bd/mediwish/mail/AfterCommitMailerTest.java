package bd.mediwish.mail;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.transaction.support.TransactionSynchronization;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AfterCommitMailerTest {
    @AfterEach
    void clearSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive())
            TransactionSynchronizationManager.clearSynchronization();
    }

    @Test
    void sendsOnlyAfterTheTransactionCommits() {
        List<EmailMessage> delivered = new ArrayList<>();
        var mailer = new AfterCommitMailer(delivered::add, Runnable::run);
        var message = new EmailMessage("synthetic@example.test", "Synthetic subject", "Synthetic body",
                EmailKind.PASSWORD_CHANGED);
        TransactionSynchronizationManager.initSynchronization();
        mailer.sendAfterCommit(message, () -> { throw new AssertionError("Unexpected delivery failure"); });
        assertThat(delivered).isEmpty();
        TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());
        assertThat(delivered).containsExactly(message);
    }

    @Test
    void rollbackNeverQueuesOrSendsMail() {
        List<Runnable> tasks = new ArrayList<>();
        var mailer = new AfterCommitMailer(message -> { throw new AssertionError("Unexpected delivery"); }, tasks::add);
        TransactionSynchronizationManager.initSynchronization();
        mailer.sendAfterCommit(message(), () -> { throw new AssertionError("Unexpected failure callback"); });
        TransactionSynchronizationManager.getSynchronizations().forEach(sync ->
                sync.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
        assertThat(tasks).isEmpty();
    }

    @Test
    void commitQueuesTheTransportRatherThanDoingMailIoOnTheCommittingThread() {
        List<Runnable> tasks = new ArrayList<>();
        List<EmailMessage> delivered = new ArrayList<>();
        var mailer = new AfterCommitMailer(delivered::add, tasks::add);
        TransactionSynchronizationManager.initSynchronization();
        mailer.sendAfterCommit(message(), () -> {});
        TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());
        assertThat(delivered).isEmpty();
        assertThat(tasks).hasSize(1);
        tasks.getFirst().run();
        assertThat(delivered).containsExactly(message());
    }

    @Test
    void deliveryFailureCallsTheOutcomeOnceAndNeverRetriesOrEscapesTheCommittedTransaction() {
        var attempts = new AtomicInteger();
        var outcomes = new AtomicInteger();
        var mailer = new AfterCommitMailer(message -> {
            attempts.incrementAndGet();
            throw new IllegalStateException("PRIVATE_PROVIDER_TEXT");
        }, Runnable::run);
        TransactionSynchronizationManager.initSynchronization();
        mailer.sendAfterCommit(message(), () -> {
            outcomes.incrementAndGet();
            throw new IllegalStateException("PRIVATE_AUDIT_TEXT");
        });
        assertThatCode(() -> TransactionSynchronizationManager.getSynchronizations()
                .forEach(sync -> sync.afterCommit())).doesNotThrowAnyException();
        assertThat(attempts.get()).isEqualTo(1);
        assertThat(outcomes.get()).isEqualTo(1);
    }

    @Test
    void aFullOrStoppedExecutorReportsOneSafeFailureWithoutSending() {
        var outcomes = new AtomicInteger();
        var mailer = new AfterCommitMailer(message -> { throw new AssertionError("Unexpected delivery"); },
                task -> { throw new RejectedExecutionException("PRIVATE_EXECUTOR_TEXT"); });
        TransactionSynchronizationManager.initSynchronization();
        mailer.sendAfterCommit(message(), outcomes::incrementAndGet);
        assertThatCode(() -> TransactionSynchronizationManager.getSynchronizations()
                .forEach(sync -> sync.afterCommit())).doesNotThrowAnyException();
        assertThat(outcomes.get()).isEqualTo(1);
    }

    @Test
    void requiresTheTransactionBoundaryAndMessageDiagnosticsContainOnlyTheKind() {
        var mailer = new AfterCommitMailer(message -> {}, Runnable::run);
        assertThatThrownBy(() -> mailer.sendAfterCommit(message(), () -> {}))
                .isInstanceOf(IllegalStateException.class);
        assertThat(message().toString().equals("EmailMessage[kind=PASSWORD_RESET_CODE]")).isTrue();
    }

    private static EmailMessage message() {
        return new EmailMessage("synthetic@example.test", "Private subject", "Private body 042917",
                EmailKind.PASSWORD_RESET_CODE);
    }
}
