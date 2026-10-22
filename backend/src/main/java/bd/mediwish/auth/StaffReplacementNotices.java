package bd.mediwish.auth;

import bd.mediwish.notification.*;
import bd.mediwish.user.UserRepository;
import jakarta.annotation.PreDestroy;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionOperations;
import java.time.Clock;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.*;

/** Sends only after replacement commits; delivery and audit failures cannot hide new backup codes. */
@Component
class StaffReplacementNotices {
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH)
            .withZone(ZoneId.of("Asia/Dhaka"));
    private final UserRepository users;
    private final SecurityNotifier notifier;
    private final MessageSource messages;
    private final SecurityAuditLog audit;
    private final TransactionOperations transactions;
    private final NotificationProperties properties;
    private final Clock clock;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    StaffReplacementNotices(UserRepository users, SecurityNotifier notifier, MessageSource messages,
                            SecurityAuditLog audit, TransactionOperations transactions,
                            NotificationProperties properties, Clock clock) {
        this.users = users;
        this.notifier = notifier;
        this.messages = messages;
        this.audit = audit;
        this.transactions = transactions;
        this.properties = properties;
        this.clock = clock;
    }

    NoticeOutcome notifyReplacement(UUID userId) {
        NoticeOutcome outcome;
        try {
            var user = users.findById(userId).orElseThrow();
            if (!user.mobileVerified()) outcome = NoticeOutcome.NO_VERIFIED_CONTACT;
            else {
                String text = messages.getMessage("notice.STAFF_AUTHENTICATOR_REPLACED",
                        new Object[]{TIME.format(clock.instant())}, Locale.ENGLISH);
                outcome = send(new SecurityNotice(user.mobile(), text));
            }
        } catch (Exception failure) { outcome = NoticeOutcome.FAILED; }
        var type = switch (outcome) {
            case SENT -> SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_SENT;
            case FAILED -> SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED;
            case NO_VERIFIED_CONTACT -> SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NO_VERIFIED_CONTACT;
            case NOT_CONFIGURED -> SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NOT_CONFIGURED;
        };
        // An interrupted wait must not cost the audit row: clear the flag for the audit, then restore it.
        boolean interrupted = Thread.interrupted();
        try { transactions.executeWithoutResult(status -> audit.record(type, userId, null)); }
        catch (Exception failure) { /* Replacement has committed; audit failure cannot change the outcome. */ }
        finally { if (interrupted) Thread.currentThread().interrupt(); }
        return outcome;
    }

    private NoticeOutcome send(SecurityNotice notice) throws ExecutionException, TimeoutException, InterruptedException {
        Future<NoticeOutcome> future = executor.submit(() -> notifier.send(notice));
        try { return future.get(properties.timeout().toMillis(), TimeUnit.MILLISECONDS); }
        catch (TimeoutException timeout) { future.cancel(true); throw timeout; }
        catch (InterruptedException interrupted) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw interrupted;
        }
    }

    @PreDestroy void close() { executor.shutdownNow(); }
}
