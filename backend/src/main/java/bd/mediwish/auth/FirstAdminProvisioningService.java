package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserIdentifierNormalizer;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * Grants ADMIN to one already registered User, exactly once for the life of the database, and records them as the
 * Super Admin (S1). The claimed {@code staff_bootstrap} row is permanent, so provisioning never reopens, even when
 * every Admin is later removed or locked out.
 */
@Service
class FirstAdminProvisioningService {
    enum Outcome { PROVISIONED, BOOTSTRAP_USED, ADMIN_EXISTS, USER_NOT_FOUND }

    private final UserRepository users;
    private final StaffBootstrapRepository bootstrap;
    private final SessionService sessions;
    private final SecurityAuditLog audit;
    private final UserIdentifierNormalizer identifiers;
    private final TransactionOperations transactions;
    private final Clock clock;

    FirstAdminProvisioningService(UserRepository users, StaffBootstrapRepository bootstrap, SessionService sessions,
                                  SecurityAuditLog audit, UserIdentifierNormalizer identifiers,
                                  TransactionOperations transactions, Clock clock) {
        this.users = users;
        this.bootstrap = bootstrap;
        this.sessions = sessions;
        this.audit = audit;
        this.identifiers = identifiers;
        this.transactions = transactions;
        this.clock = clock;
    }

    /** The refusal order is fixed: a used bootstrap, then an existing Admin, then a missing or unusable User. */
    static Outcome decide(boolean bootstrapUsed, boolean adminExists, boolean userEligible) {
        if (bootstrapUsed) return Outcome.BOOTSTRAP_USED;
        if (adminExists) return Outcome.ADMIN_EXISTS;
        if (!userEligible) return Outcome.USER_NOT_FOUND;
        return Outcome.PROVISIONED;
    }

    Outcome provision(String username) {
        return transactions.execute(status -> {
            Instant now = clock.instant();
            User user = users.findByUsername(identifiers.username(username))
                    .filter(candidate -> PasswordVerifierPolicy.isUsable(candidate.passwordHash())).orElse(null);
            UUID userId = user == null ? null : user.id();
            // Claiming first makes a concurrent run wait on the row, then see it and refuse.
            boolean claimed = bootstrap.claim(userId, now) == 1;
            Outcome outcome = decide(!claimed, claimed && users.existsByRole(UserRole.ADMIN), user != null);
            if (outcome != Outcome.PROVISIONED) {
                status.setRollbackOnly();
                return outcome;
            }
            User locked = users.findByIdForUpdate(userId).orElseThrow();
            locked.grantRole(UserRole.ADMIN);
            users.save(locked);
            // A session from before the promotion is revoked; the new Admin signs in again and must enroll MFA.
            sessions.revokeAllForUser(userId, RevocationReason.STAFF_PROVISIONED);
            audit.record(SecurityAuditEvent.Type.FIRST_ADMIN_PROVISIONED, userId, null);
            return Outcome.PROVISIONED;
        });
    }
}
