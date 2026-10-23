package bd.mediwish.auth;

import bd.mediwish.mail.AfterCommitMailer;
import bd.mediwish.mail.EmailKind;
import bd.mediwish.mail.EmailMessage;
import bd.mediwish.user.User;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Component;
import java.util.Locale;
import java.util.UUID;

/** Composes transient credential mail and records only a safe failure outcome. */
@Component
class AccountMail {
    private final MessageSource messages;
    private final AfterCommitMailer mailer;
    private final SecurityAuditLog audit;

    AccountMail(MessageSource messages, AfterCommitMailer mailer, SecurityAuditLog audit) {
        this.messages=messages; this.mailer=mailer; this.audit=audit;
    }
    void verificationCode(User user, String code) {
        send(user.id(), user.email(), EmailKind.EMAIL_VERIFICATION_CODE, "emailVerificationCode", code);
    }
    void resetCode(User user, String code) {
        send(user.id(), user.email(), EmailKind.PASSWORD_RESET_CODE, "passwordResetCode", code);
    }
    void passwordChanged(User user) {
        send(user.id(), user.email(), EmailKind.PASSWORD_CHANGED, "passwordChanged", null);
    }
    void emailChanged(UUID userId, String oldEmail) {
        send(userId, oldEmail, EmailKind.EMAIL_CHANGED, "emailChanged", null);
    }
    private void send(UUID userId, String to, EmailKind kind, String key, String code) {
        Object[] arguments = code == null ? null : new Object[]{code};
        var message = new EmailMessage(to, messages.getMessage("mail." + key + ".subject", null, Locale.ENGLISH),
                messages.getMessage("mail." + key + ".body", arguments, Locale.ENGLISH), kind);
        mailer.sendAfterCommit(message,
                () -> audit.recordInNewTransaction(SecurityAuditEvent.Type.EMAIL_DELIVERY_FAILED, userId));
    }
}
