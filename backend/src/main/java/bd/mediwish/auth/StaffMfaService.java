package bd.mediwish.auth;

import bd.mediwish.user.User;
import org.bouncycastle.util.encoders.Base32;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.OptionalLong;
import java.util.UUID;

import static bd.mediwish.auth.StaffMfaAttempts.Outcome;
import static bd.mediwish.auth.StaffMfaAttempts.Result;
import static bd.mediwish.auth.StaffMfaAttempts.sessionOrThrow;

/**
 * Staff authenticator enrollment and verification (Ticket 06). Every change of a User's MFA state takes that User's
 * row lock first, so their factors, throttle and sessions have one writer at a time. A wrong code is committed as a
 * throttle failure before the error is thrown, so rate limiting cannot be rolled back.
 */
@Service
class StaffMfaService {
    private static final int SEED_BYTES = 20;

    private final StaffMfaAttempts attempts;
    private final StaffMfaFactorRepository factors;
    private final StaffMfaBackupCodeRepository backupCodes;
    private final StaffMfaThrottleRepository throttles;
    private final SessionService sessions;
    private final AuthenticationService authentication;
    private final SecurityAuditLog audit;
    private final MfaSecretCipher cipher;
    private final PasswordEncoder passwords;
    private final TransactionOperations transactions;
    private final AuthProperties.Mfa settings;
    private final Clock clock;
    private final SecureRandom random;

    StaffMfaService(StaffMfaAttempts attempts, StaffMfaFactorRepository factors, StaffMfaBackupCodeRepository backupCodes,
                    StaffMfaThrottleRepository throttles, SessionService sessions,
                    AuthenticationService authentication, SecurityAuditLog audit, MfaSecretCipher cipher,
                    PasswordEncoder passwords, TransactionOperations transactions, AuthProperties properties,
                    Clock clock, SecureRandom random) {
        this.attempts = attempts;
        this.factors = factors;
        this.backupCodes = backupCodes;
        this.throttles = throttles;
        this.sessions = sessions;
        this.authentication = authentication;
        this.audit = audit;
        this.cipher = cipher;
        this.passwords = passwords;
        this.transactions = transactions;
        this.settings = properties.mfa();
        this.clock = clock;
        this.random = random;
    }

    /** The seed is returned only here; starting again replaces the pending factor and its seed. */
    record Enrollment(UUID enrollmentId, String secret, String otpauthUri, long expiresIn) {}

    record EnrolledSession(AuthenticationService.AuthenticatedSession session, List<String> backupCodes) {}

    Enrollment startEnrollment(UUID userId, UUID sessionId) {
        return transactions.execute(status -> {
            Instant now = clock.instant();
            var locked = attempts.lockActiveStaff(userId, sessionId, now);
            User user = locked.user();
            UUID activeFactorId = factors.findActiveId(userId).orElse(null);
            if (activeFactorId != null && !activeFactorId.equals(locked.evidence().replacingFactorId())) {
                throw new MfaEnrollmentStaleException();
            }
            factors.deletePending(userId);
            byte[] seed = new byte[SEED_BYTES];
            random.nextBytes(seed);
            UUID factorId = UUID.randomUUID();
            factors.save(new StaffMfaFactor(factorId, userId, cipher.encrypt(factorId, seed), now,
                    now.plus(settings.enrollmentLifetime())));
            audit.record(SecurityAuditEvent.Type.MFA_ENROLLMENT_STARTED, userId, sessionId);
            String secret = Base32.toBase32String(seed);
            Arrays.fill(seed, (byte) 0);
            return new Enrollment(factorId, secret, otpauthUri(user.username(), secret),
                    settings.enrollmentLifetime().toSeconds());
        });
    }

    EnrolledSession verifyEnrollment(UUID userId, UUID sessionId, UUID enrollmentId, String code) {
        // A locked User is refused before the slow hashing; the transaction below repeats the check under the lock.
        if (throttles.findById(userId).filter(throttle -> throttle.isLocked(clock.instant())).isPresent()) {
            throw new TooManyAttemptsException();
        }
        // Argon2 is slow, so the verifiers are computed before the transaction holds a connection and the row lock.
        List<String> codes = BackupCodes.generate(random);
        List<String> verifiers = codes.stream().map(backup -> passwords.encode(BackupCodes.normalize(backup))).toList();
        Outcome outcome = transactions.execute(status -> {
            Instant now = clock.instant();
            var locked = attempts.lockActiveStaff(userId, sessionId, now);
            if (locked.evidence().replacingFactorId() != null) throw new MfaEnrollmentStaleException();
            User user = locked.user();
            StaffMfaThrottle throttle = attempts.throttle(userId, now);
            if (throttle.isLocked(now)) return Outcome.LOCKED;
            if (factors.findActiveId(userId).isPresent()) throw new MfaEnrollmentStaleException();
            StaffMfaFactor factor = factors.findPending(userId)
                    .filter(pending -> pending.id().equals(enrollmentId) && !pending.pendingExpired(now))
                    .orElseThrow(MfaEnrollmentStaleException::new);
            OptionalLong step = attempts.matchStep(factor, code, now);
            if (step.isEmpty()) return attempts.failure(throttle, userId, sessionId, now,
                    SecurityAuditEvent.Type.MFA_VERIFICATION_FAILED);
            factor.activate(now, step.getAsLong());
            verifiers.forEach(verifier ->
                    backupCodes.save(new StaffMfaBackupCode(UUID.randomUUID(), factor.id(), verifier, now)));
            throttle.reset(now);
            var verified = sessions.upgradeToMfa(sessionId, factor.id());
            audit.record(SecurityAuditEvent.Type.MFA_ENROLLMENT_ACTIVATED, userId, verified.sessionId());
            return new Outcome(Result.VERIFIED, authentication.issue(user, verified));
        });
        return new EnrolledSession(sessionOrThrow(outcome), codes);
    }

    AuthenticationService.AuthenticatedSession verify(UUID userId, UUID sessionId, String code) {
        Outcome outcome = transactions.execute(status -> {
            Instant now = clock.instant();
            User user = attempts.lockActiveStaff(userId, sessionId, now).user();
            StaffMfaThrottle throttle = attempts.throttle(userId, now);
            if (throttle.isLocked(now)) return Outcome.LOCKED;
            StaffMfaFactor factor = factors.findActive(userId).orElseThrow(() -> new AccessDeniedException("no factor"));
            OptionalLong step = attempts.matchStep(factor, code, now);
            if (step.isEmpty()) return attempts.failure(throttle, userId, sessionId, now,
                    SecurityAuditEvent.Type.MFA_VERIFICATION_FAILED);
            factor.recordUse(step.getAsLong());
            throttle.reset(now);
            var verified = sessions.upgradeToMfa(sessionId, factor.id());
            audit.record(SecurityAuditEvent.Type.MFA_VERIFIED, userId, verified.sessionId());
            return new Outcome(Result.VERIFIED, authentication.issue(user, verified));
        });
        return sessionOrThrow(outcome);
    }

    /** The Key URI Format authenticator apps scan; the label is {@code issuer:username}. */
    private String otpauthUri(String username, String secret) {
        String issuer = encode(settings.issuer());
        return "otpauth://totp/" + issuer + ":" + encode(username) + "?secret=" + secret + "&issuer=" + issuer
                + "&algorithm=SHA1&digits=6&period=" + Totp.STEP_SECONDS;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
