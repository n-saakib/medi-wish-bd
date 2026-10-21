package bd.mediwish.auth;

import bd.mediwish.notification.NoticeOutcome;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import static bd.mediwish.auth.StaffMfaAttempts.Outcome;
import static bd.mediwish.auth.StaffMfaAttempts.Result;
import static bd.mediwish.auth.StaffMfaAttempts.sessionOrThrow;

/** Backup-code recovery and replacement; User locking and committed failures follow the shared MFA rules. */
@Service
class StaffMfaRecoveryService {
    private final StaffMfaFactorRepository factors;
    private final StaffMfaBackupCodeRepository codes;
    private final StaffMfaThrottleRepository throttles;
    private final SessionService sessions;
    private final AuthenticationService authentication;
    private final SecurityAuditLog audit;
    private final StaffMfaAttempts attempts;
    private final StaffReplacementNotices notices;
    private final PasswordEncoder passwords;
    private final TransactionOperations transactions;
    private final Clock clock;
    private final SecureRandom random;

    StaffMfaRecoveryService(StaffMfaFactorRepository factors, StaffMfaBackupCodeRepository codes,
                            StaffMfaThrottleRepository throttles, SessionService sessions,
                            AuthenticationService authentication, SecurityAuditLog audit, StaffMfaAttempts attempts,
                            StaffReplacementNotices notices, PasswordEncoder passwords, TransactionOperations transactions,
                            Clock clock, SecureRandom random) {
        this.factors = factors;
        this.codes = codes;
        this.throttles = throttles;
        this.sessions = sessions;
        this.authentication = authentication;
        this.audit = audit;
        this.attempts = attempts;
        this.notices = notices;
        this.passwords = passwords;
        this.transactions = transactions;
        this.clock = clock;
        this.random = random;
    }

    AuthenticationService.AuthenticatedSession useBackupCode(UUID userId, UUID sessionId, String parsedCode) {
        requireUnlocked(userId);
        UUID factorId = factors.findActiveId(userId).orElse(null);
        List<StaffMfaBackupCode> unused = factorId == null ? List.of() : codes.findByFactorIdAndConsumedAtIsNull(factorId);
        UUID firstMatch = null;
        for (var row : unused) {
            boolean matches = passwords.matches(parsedCode, row.codeVerifier());
            if (matches && firstMatch == null) firstMatch = row.id();
        }
        UUID matchedId = firstMatch;
        Outcome outcome = transactions.execute(status -> {
            Instant now = clock.instant();
            var locked = attempts.lockActiveStaff(userId, sessionId, now);
            var throttle = attempts.throttle(userId, now);
            if (throttle.isLocked(now)) return Outcome.LOCKED;
            if (!Objects.equals(factorId, factors.findActiveId(userId).orElse(null)) || matchedId == null
                    || codes.consume(matchedId, factorId, now, sessionId) == 0) {
                return attempts.failure(throttle, userId, sessionId, now, SecurityAuditEvent.Type.MFA_RECOVERY_CODE_REJECTED);
            }
            throttle.reset(now);
            var credential = sessions.startReplacement(sessionId, factorId);
            audit.record(SecurityAuditEvent.Type.MFA_RECOVERY_STARTED, userId, credential.sessionId());
            return new Outcome(Result.VERIFIED, authentication.issue(locked.user(), credential));
        });
        return sessionOrThrow(outcome);
    }

    ReplacedSession verifyReplacement(UUID userId, UUID sessionId, UUID enrollmentId, String code) {
        requireUnlocked(userId);
        List<String> freshCodes = BackupCodes.generate(random);
        List<String> verifiers = freshCodes.stream().map(backup -> passwords.encode(BackupCodes.normalize(backup))).toList();
        Outcome outcome = transactions.execute(status -> {
            Instant now = clock.instant();
            var locked = attempts.lockActiveStaff(userId, sessionId, now);
            var throttle = attempts.throttle(userId, now);
            if (throttle.isLocked(now)) return Outcome.LOCKED;
            var active = factors.findActive(userId).orElseThrow(MfaEnrollmentStaleException::new);
            if (!active.id().equals(locked.evidence().replacingFactorId())) throw new MfaEnrollmentStaleException();
            var pending = factors.findPending(userId)
                    .filter(factor -> factor.id().equals(enrollmentId) && !factor.pendingExpired(now))
                    .orElseThrow(MfaEnrollmentStaleException::new);
            var step = attempts.matchStep(pending, code, now);
            if (step.isEmpty()) return attempts.failure(throttle, userId, sessionId, now,
                    SecurityAuditEvent.Type.MFA_VERIFICATION_FAILED);
            active.revoke(now);
            factors.flush();
            codes.deleteByFactor(active.id());
            pending.activate(now, step.getAsLong());
            verifiers.forEach(verifier -> codes.save(new StaffMfaBackupCode(UUID.randomUUID(), pending.id(), verifier, now)));
            throttle.reset(now);
            var credential = sessions.replaceAllWithVerified(userId, pending.id());
            audit.record(SecurityAuditEvent.Type.MFA_FACTOR_REPLACED, userId, credential.sessionId());
            return new Outcome(Result.VERIFIED, authentication.issue(locked.user(), credential));
        });
        var session = sessionOrThrow(outcome);
        return new ReplacedSession(session, freshCodes, notices.notifyReplacement(userId));
    }

    List<String> regenerateBackupCodes(UUID userId, UUID sessionId, String code) {
        requireUnlocked(userId);
        List<String> freshCodes = BackupCodes.generate(random);
        List<String> verifiers = freshCodes.stream().map(backup -> passwords.encode(BackupCodes.normalize(backup))).toList();
        Outcome outcome = transactions.execute(status -> {
            Instant now = clock.instant();
            var locked = attempts.lockActiveStaff(userId, sessionId, now);
            var throttle = attempts.throttle(userId, now);
            if (throttle.isLocked(now)) return Outcome.LOCKED;
            var active = factors.findActive(userId).orElseThrow(() -> new AccessDeniedException("no factor"));
            if (!active.id().equals(locked.evidence().factorId()) || locked.evidence().verifiedAt() == null) {
                throw new AccessDeniedException("MFA verification required");
            }
            var step = attempts.matchStep(active, code, now);
            if (step.isEmpty()) return attempts.failure(throttle, userId, sessionId, now,
                    SecurityAuditEvent.Type.MFA_VERIFICATION_FAILED);
            active.recordUse(step.getAsLong());
            codes.deleteUnusedByFactor(active.id());
            verifiers.forEach(verifier -> codes.save(new StaffMfaBackupCode(UUID.randomUUID(), active.id(), verifier, now)));
            throttle.reset(now);
            audit.record(SecurityAuditEvent.Type.MFA_BACKUP_CODES_REGENERATED, userId, sessionId);
            return new Outcome(Result.VERIFIED, null);
        });
        sessionOrThrow(outcome);
        return freshCodes;
    }

    private void requireUnlocked(UUID userId) {
        if (throttles.findById(userId).filter(throttle -> throttle.isLocked(clock.instant())).isPresent()) {
            throw new TooManyAttemptsException();
        }
    }

    record ReplacedSession(AuthenticationService.AuthenticatedSession session, List<String> backupCodes,
                           NoticeOutcome contactNotice) {
        @Override
        public String toString() { return "ReplacedSession[redacted]"; }
    }
}
