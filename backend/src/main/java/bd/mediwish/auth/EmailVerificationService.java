package bd.mediwish.auth;

import bd.mediwish.user.AccountClosingException;
import bd.mediwish.user.AccountState;
import bd.mediwish.user.EmailRequiredException;
import bd.mediwish.user.MobileChangeRepository;
import bd.mediwish.user.ProfileView;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

/** Verifies only the caller's saved email; issuing a code never verifies an address. */
@Service
public class EmailVerificationService {
    private final UserRepository users;
    private final MobileChangeRepository mobileChanges;
    private final AccountCodeRepository codes;
    private final AccountCodeIssuer issuer;
    private final AccountCodeHasher hasher;
    private final AccountMail mail;
    private final SecurityAuditLog audit;
    private final AuthProperties.Recovery settings;
    private final Clock clock;

    EmailVerificationService(UserRepository users, MobileChangeRepository mobileChanges,
            AccountCodeRepository codes, AccountCodeIssuer issuer, AccountCodeHasher hasher,
            AccountMail mail, SecurityAuditLog audit, AuthProperties properties, Clock clock) {
        this.users = users;
        this.mobileChanges = mobileChanges;
        this.codes = codes;
        this.issuer = issuer;
        this.hasher = hasher;
        this.mail = mail;
        this.audit = audit;
        this.settings = properties.recovery();
        this.clock = clock;
    }

    @Transactional
    public void request(UUID userId) {
        User user = users.findByIdForUpdate(userId).orElseThrow(AuthenticationRequiredException::new);
        if (user.accountState() != AccountState.ACTIVE) throw new AccountClosingException();
        if (user.email() == null) throw new EmailRequiredException();
        if (user.emailVerified()) return;
        String code = issuer.issue(user, AccountCodePurpose.EMAIL_VERIFICATION, clock.instant())
                .orElseThrow(TooManyAttemptsException::new);
        audit.record(SecurityAuditEvent.Type.EMAIL_VERIFICATION_REQUESTED, userId, null);
        mail.verificationCode(user, code);
    }

    /** Failed attempts must commit, so the invalid-code exception does not roll this transaction back. */
    @Transactional(noRollbackFor = CodeInvalidException.class)
    public ProfileView confirm(UUID userId, String suppliedCode) {
        User user = users.findByIdForUpdate(userId).orElseThrow(AuthenticationRequiredException::new);
        if (user.accountState() != AccountState.ACTIVE) throw new AccountClosingException();
        if (user.email() == null) throw new EmailRequiredException();
        if (user.emailVerified()) return ProfileView.from(user, mobileChanges.findByUserId(userId).orElse(null));
        var now = clock.instant();
        var purpose = AccountCodePurpose.EMAIL_VERIFICATION;
        AccountCode code = codes.findByUserIdAndPurpose(userId, purpose).orElse(null);
        var check = AccountCodeRules.check(code, user.email(), now, settings.maxWrongTries());
        if (check != AccountCodeRules.Check.USABLE) {
            if (check == AccountCodeRules.Check.EXPIRED || check == AccountCodeRules.Check.ADDRESS_CHANGED
                    || check == AccountCodeRules.Check.LOCKED) codes.deleteByUserIdAndPurpose(userId, purpose);
            throw new CodeInvalidException();
        }
        if (!hasher.matches(purpose, code.id(), suppliedCode, code.codeHash())) {
            boolean locked = AccountCodeRules.afterWrongTry(code.failedAttempts(), settings.maxWrongTries()).voided();
            code.recordFailure();
            if (locked) codes.deleteByUserIdAndPurpose(userId, purpose);
            audit.record(locked ? SecurityAuditEvent.Type.ACCOUNT_CODE_LOCKED : SecurityAuditEvent.Type.ACCOUNT_CODE_FAILED,
                    userId, null);
            throw new CodeInvalidException();
        }
        user.markEmailVerified(now);
        codes.deleteByUserIdAndPurpose(userId, purpose);
        audit.record(SecurityAuditEvent.Type.EMAIL_VERIFIED, userId, null);
        return ProfileView.from(user, mobileChanges.findByUserId(userId).orElse(null));
    }
}
