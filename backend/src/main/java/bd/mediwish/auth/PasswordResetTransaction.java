package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.util.UUID;

/** Returns failed-code outcomes so their counters commit before the public error is raised. */
@Service
class PasswordResetTransaction {
    enum Outcome { RESET, INVALID }
    private static final UUID DUMMY_ID = new UUID(0, 0);
    private final UserRepository users;
    private final EntityManager entities;
    private final AccountCodeRepository codes;
    private final AccountCodeHasher hasher;
    private final SessionService sessions;
    private final SecurityAuditLog audit;
    private final AccountMail mail;
    private final AuthProperties.Recovery settings;
    private final Clock clock;
    private final String dummyHash;

    PasswordResetTransaction(UserRepository users, EntityManager entities, AccountCodeRepository codes,
                             AccountCodeHasher hasher, SessionService sessions, SecurityAuditLog audit,
                             AccountMail mail, AuthProperties properties, Clock clock) {
        this.users=users; this.entities=entities; this.codes=codes; this.hasher=hasher; this.sessions=sessions;
        this.audit=audit; this.mail=mail; this.settings=properties.recovery(); this.clock=clock;
        this.dummyHash=hasher.codeHash(AccountCodePurpose.PASSWORD_RESET, DUMMY_ID, "000000");
    }

    @Transactional
    Outcome apply(String email, String codeValue, String passwordHash) {
        User candidate = users.findByEmailIgnoreCase(email).orElse(null);
        if (candidate == null || !eligible(candidate, email)) return invalidWithoutCode(codeValue);
        User user = users.findByIdForUpdate(candidate.id()).orElse(null);
        if (user == null) return invalidWithoutCode(codeValue);
        entities.refresh(user);
        if (!eligible(user, email)) return invalidWithoutCode(codeValue);
        var code = codes.findByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET).orElse(null);
        var check = AccountCodeRules.check(code, user.email(), clock.instant(), settings.maxWrongTries());
        if (check != AccountCodeRules.Check.USABLE) {
            if (check == AccountCodeRules.Check.EXPIRED || check == AccountCodeRules.Check.ADDRESS_CHANGED
                    || check == AccountCodeRules.Check.LOCKED) {
                codes.deleteByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET);
            }
            return Outcome.INVALID;
        }
        if (!hasher.matches(AccountCodePurpose.PASSWORD_RESET, code.id(), codeValue, code.codeHash())) {
            var wrong = AccountCodeRules.afterWrongTry(code.failedAttempts(), settings.maxWrongTries());
            code.recordFailure();
            if (wrong.voided()) {
                codes.deleteByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET);
                audit.record(SecurityAuditEvent.Type.ACCOUNT_CODE_LOCKED, user.id(), null);
            } else {
                audit.record(SecurityAuditEvent.Type.ACCOUNT_CODE_FAILED, user.id(), null);
            }
            return Outcome.INVALID;
        }
        user.changePasswordHash(passwordHash);
        codes.deleteByUserId(user.id());
        sessions.revokeAllForUser(user.id(), RevocationReason.PASSWORD_RESET);
        audit.record(SecurityAuditEvent.Type.PASSWORD_RESET_COMPLETED, user.id(), null);
        mail.passwordChanged(user);
        return Outcome.RESET;
    }

    private Outcome invalidWithoutCode(String code) {
        hasher.matches(AccountCodePurpose.PASSWORD_RESET, DUMMY_ID, code, dummyHash);
        return Outcome.INVALID;
    }

    private static boolean eligible(User user, String email) {
        return email.equalsIgnoreCase(user.email()) && AccountCodeRules.resetEligible(user.emailVerified(),
                user.accountState(), PasswordVerifierPolicy.isUsable(user.passwordHash()));
    }
}
