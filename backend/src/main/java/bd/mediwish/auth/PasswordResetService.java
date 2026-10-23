package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Public recovery requests do not reveal eligibility, account existence or throttling. */
@Service
public class PasswordResetService {
    private final UserRepository users;
    private final EntityManager entities;
    private final AccountCodeLimitRepository limits;
    private final AccountCodeHasher hasher;
    private final AccountCodeIssuer issuer;
    private final AccountMail mail;
    private final SecurityAuditLog audit;
    private final AuthProperties.Recovery settings;
    private final Clock clock;
    private final PasswordEncoder passwords;
    private final PasswordResetTransaction resets;

    PasswordResetService(UserRepository users, EntityManager entities, AccountCodeLimitRepository limits,
                         AccountCodeHasher hasher, AccountCodeIssuer issuer, AccountMail mail,
                         SecurityAuditLog audit, AuthProperties properties, Clock clock,
                         PasswordEncoder passwords, PasswordResetTransaction resets) {
        this.users=users; this.entities=entities; this.limits=limits; this.hasher=hasher; this.issuer=issuer;
        this.mail=mail; this.audit=audit; this.settings=properties.recovery(); this.clock=clock;
        this.passwords=passwords; this.resets=resets;
    }

    @Transactional
    public void request(String email) {
        var now = clock.instant();
        issueIfAllowed(email, now);
        // Every normal outcome prunes; a failed statement skips it so the aborted transaction keeps its root cause.
        // No User lock follows cleanup; SKIP LOCKED also avoids waiting on another request's active counters.
        limits.pruneBefore(now.minus(settings.limitRetention()));
    }

    private void issueIfAllowed(String email, Instant now) {
        var address = limits.recordAddressRequest(hasher.addressKey(email), now, now.minus(settings.addressWindow()));
        if (address.attempts() > settings.addressRequestsPerWindow()) return;
        User candidate = users.findByEmailIgnoreCase(email).orElse(null);
        if (candidate == null || !eligible(candidate, email)) return;
        User user = users.findByIdForUpdate(candidate.id()).orElse(null);
        if (user == null) return;
        // The first lookup may already be managed: a locking query alone does not refresh it after waiting.
        entities.refresh(user);
        if (!eligible(user, email)) return;
        var code = issuer.issue(user, AccountCodePurpose.PASSWORD_RESET, clock.instant());
        if (code.isEmpty()) return;
        audit.record(SecurityAuditEvent.Type.PASSWORD_RESET_REQUESTED, user.id(), null);
        mail.resetCode(user, code.get());
    }

    /** Hash before lookup and outside the transaction so Argon2 holds no pooled connection. */
    public void confirm(String email, String code, String newPassword) {
        String hash = passwords.encode(newPassword);
        if (resets.apply(email, code, hash) == PasswordResetTransaction.Outcome.INVALID) {
            throw new CodeInvalidException();
        }
    }

    private static boolean eligible(User user, String email) {
        return email.equalsIgnoreCase(user.email()) && AccountCodeRules.resetEligible(user.emailVerified(),
                user.accountState(), PasswordVerifierPolicy.isUsable(user.passwordHash()));
    }
}
