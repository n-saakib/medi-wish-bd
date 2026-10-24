package bd.mediwish.auth;

import bd.mediwish.mail.*;
import bd.mediwish.notification.*;
import bd.mediwish.user.UserRepository;
import jakarta.annotation.PreDestroy;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Component;
import java.time.Clock;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
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
    private final EmailTransport email;
    private final MailProperties mailProperties;
    private final MessageSource messages;
    private final SecurityAuditLog audit;
    private final NotificationProperties properties;
    private final Clock clock;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    StaffReplacementNotices(UserRepository users, SecurityNotifier notifier, EmailTransport email,
                            MailProperties mailProperties, MessageSource messages, SecurityAuditLog audit,
                            NotificationProperties properties, Clock clock) {
        this.users = users;
        this.notifier = notifier;
        this.email = email;
        this.mailProperties = mailProperties;
        this.messages = messages;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    NoticeOutcome notifyReplacement(UUID userId) {
        NoticeOutcome outcome;
        try { outcome = deliver(userId); }
        catch (Exception failure) { outcome = NoticeOutcome.FAILED; }
        var type = switch (outcome) {
            case SENT -> SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_SENT;
            case FAILED -> SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED;
            case NO_VERIFIED_CONTACT -> SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NO_VERIFIED_CONTACT;
            case NOT_CONFIGURED -> SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NOT_CONFIGURED;
        };
        // An interrupted wait must not cost the audit row: clear the flag for the audit, then restore it.
        boolean interrupted = Thread.interrupted();
        try { audit.recordInNewTransaction(type, userId); }
        catch (Exception failure) { /* Replacement has committed; audit failure cannot change the outcome. */ }
        finally { if (interrupted) Thread.currentThread().interrupt(); }
        return outcome;
    }

    private NoticeOutcome deliver(UUID userId) throws InterruptedException, ExecutionException {
        var user = users.findById(userId).orElseThrow();
        if (!user.mobileVerified() && !user.emailVerified()) return NoticeOutcome.NO_VERIFIED_CONTACT;
        String time = TIME.format(clock.instant());
        var completed = new ExecutorCompletionService<NoticeOutcome>(executor);
        var pending = new ArrayList<Future<NoticeOutcome>>(2);
        long deadline = System.nanoTime() + properties.timeout().toNanos();
        NoticeOutcome combined = NoticeOutcome.NOT_CONFIGURED;
        try {
            if (user.mobileVerified()) pending.add(completed.submit(() -> attempt(() -> notifier.send(
                    new SecurityNotice(user.mobile(), messages.getMessage("notice.STAFF_AUTHENTICATOR_REPLACED",
                            new Object[]{time}, Locale.ENGLISH))))));
            if (user.emailVerified()) pending.add(completed.submit(() -> attempt(() -> {
                if ("disabled".equals(mailProperties.transport())) return NoticeOutcome.NOT_CONFIGURED;
                email.send(new EmailMessage(user.email(),
                        messages.getMessage("mail.staffAuthenticatorReplaced.subject", null, Locale.ENGLISH),
                        messages.getMessage("mail.staffAuthenticatorReplaced.body", new Object[]{time}, Locale.ENGLISH),
                        EmailKind.STAFF_AUTHENTICATOR_REPLACED));
                return NoticeOutcome.SENT;
            })));
            for (int remaining = pending.size(); remaining > 0; remaining--) {
                Future<NoticeOutcome> result = completed.poll(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
                if (result == null) return combine(combined, NoticeOutcome.FAILED);
                combined = combine(combined, result.get());
            }
            return combined;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return combine(combined, NoticeOutcome.FAILED);
        } finally {
            pending.forEach(future -> { if (!future.isDone()) future.cancel(true); });
        }
    }

    private static NoticeOutcome attempt(Callable<NoticeOutcome> delivery) {
        try { return delivery.call(); }
        catch (Exception failure) { return NoticeOutcome.FAILED; }
    }

    private static NoticeOutcome combine(NoticeOutcome left, NoticeOutcome right) {
        if (left == NoticeOutcome.SENT || right == NoticeOutcome.SENT) return NoticeOutcome.SENT;
        if (left == NoticeOutcome.FAILED || right == NoticeOutcome.FAILED) return NoticeOutcome.FAILED;
        return NoticeOutcome.NOT_CONFIGURED;
    }

    @PreDestroy void close() { executor.shutdownNow(); }
}
