package bd.mediwish.auth;

import bd.mediwish.user.User;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import java.time.Clock;
import java.util.UUID;

/** Email-change security runs in ProfileService's transaction and preserves its failure-commit rule. */
@Component
public class AccountEmailSecurity {
    private final AccountCodeLimitRepository limits;
    private final AccountCodeRepository codes;
    private final PasswordEncoder passwords;
    private final AccountMail mail;
    private final SessionService sessions;
    private final SecurityAuditLog audit;
    private final AuthProperties.Recovery settings;
    private final Clock clock;

    AccountEmailSecurity(AccountCodeLimitRepository limits, AccountCodeRepository codes, PasswordEncoder passwords,
                         AccountMail mail, SessionService sessions, SecurityAuditLog audit,
                         AuthProperties properties, Clock clock) {
        this.limits=limits; this.codes=codes; this.passwords=passwords; this.mail=mail; this.sessions=sessions;
        this.audit=audit; this.settings=properties.recovery(); this.clock=clock;
    }

    /** Argon2 runs under the User lock only for rare, authenticated email changes bounded by this counter. */
    public void confirmCurrentPassword(User user, String password) {
        String key = "password:" + user.id();
        var now = clock.instant();
        var previous = limits.findByIdForUpdate(key).map(AccountCodeLimit::window).orElse(null);
        if (!AccountCodeRules.mayConfirmPassword(previous, now, settings.passwordAttemptsPerWindow(), settings.passwordWindow())) {
            throw new TooManyAttemptsException();
        }
        if (password == null || password.isBlank() || !passwords.matches(password, user.passwordHash())) {
            limits.save(AccountCodeLimit.next(key, previous, now, settings.passwordWindow()));
            audit.record(SecurityAuditEvent.Type.CURRENT_PASSWORD_FAILED, user.id(), null);
            throw new CurrentPasswordInvalidException();
        }
        limits.deleteById(key);
    }

    /** The profile mutation is flushed before the bulk delete clears the persistence context. */
    public void emailChanged(User user, String oldEmail, boolean oldVerified, UUID currentSessionId) {
        codes.deleteByUserId(user.id());
        audit.record(SecurityAuditEvent.Type.EMAIL_CHANGED, user.id(), currentSessionId);
        if (oldVerified) mail.emailChanged(user.id(), oldEmail);
        sessions.revokeOthersForUser(user.id(), currentSessionId, RevocationReason.EMAIL_CHANGED);
    }
}
