package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Arrays;
import java.util.OptionalLong;
import java.util.UUID;

/** Shared User locking, session checks and throttled authenticator attempts inside the caller's transaction. */
@Component
class StaffMfaAttempts {
    private final UserRepository users;
    private final SessionService sessions;
    private final StaffMfaThrottleRepository throttles;
    private final MfaSecretCipher cipher;
    private final SecurityAuditLog audit;
    private final AuthProperties.Mfa settings;

    StaffMfaAttempts(UserRepository users, SessionService sessions, StaffMfaThrottleRepository throttles,
                     MfaSecretCipher cipher, SecurityAuditLog audit, AuthProperties properties) {
        this.users = users;
        this.sessions = sessions;
        this.throttles = throttles;
        this.cipher = cipher;
        this.audit = audit;
        this.settings = properties.mfa();
    }

    record Locked(User user, SessionService.MfaEvidence evidence) {}

    enum Result { VERIFIED, INVALID, LOCKED }

    record Outcome(Result result, AuthenticationService.AuthenticatedSession session) {
        static final Outcome INVALID = new Outcome(Result.INVALID, null);
        static final Outcome LOCKED = new Outcome(Result.LOCKED, null);

        @Override
        public String toString() { return "Outcome[result=" + result + "]"; }
    }

    /** Locks the User, whose restricted session must still be active and who must still hold a staff role. */
    Locked lockActiveStaff(UUID userId, UUID sessionId, Instant now) {
        User user = users.findByIdForUpdate(userId).orElseThrow(AuthenticationRequiredException::new);
        var evidence = sessions.requireActive(sessionId, userId, now);
        if (!user.hasStaffRole()) throw new AccessDeniedException("not staff");
        return new Locked(user, evidence);
    }

    StaffMfaThrottle throttle(UUID userId, Instant now) {
        return throttles.findById(userId).orElseGet(() -> throttles.save(new StaffMfaThrottle(userId, now)));
    }

    OptionalLong matchStep(StaffMfaFactor factor, String code, Instant now) {
        byte[] seed = cipher.decrypt(factor.id(), factor.secretCiphertext(), factor.secretNonce());
        try {
            return Totp.matchStep(seed, code, now, factor.lastUsedStep());
        } finally {
            Arrays.fill(seed, (byte) 0);
        }
    }

    /** Counts the wrong code; the failure that reaches the limit locks verification and is answered as locked. */
    Outcome failure(StaffMfaThrottle throttle, UUID userId, UUID sessionId, Instant now,
                    SecurityAuditEvent.Type failedType) {
        boolean locked = throttle.recordFailure(now, settings.maxFailedAttempts(), settings.attemptWindow(),
                settings.lockout());
        audit.record(failedType, userId, sessionId);
        if (!locked) return Outcome.INVALID;
        audit.record(SecurityAuditEvent.Type.MFA_ATTEMPTS_LOCKED, userId, sessionId);
        return Outcome.LOCKED;
    }

    /** Thrown only after the transaction has committed the failure. */
    static AuthenticationService.AuthenticatedSession sessionOrThrow(Outcome outcome) {
        return switch (outcome.result()) {
            case VERIFIED -> outcome.session();
            case INVALID -> throw new MfaCodeInvalidException();
            case LOCKED -> throw new TooManyAttemptsException();
        };
    }

}
