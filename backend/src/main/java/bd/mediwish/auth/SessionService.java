package bd.mediwish.auth;

import bd.mediwish.user.User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Service
class SessionService {
    private static final int REFRESH_RANDOM_BYTES = 32;

    private final UserSessionRepository sessions;
    private final UserSessionRefreshTokenRepository refreshTokens;
    private final AuthProperties properties;
    private final Clock clock;
    private final SecureRandom random;

    SessionService(UserSessionRepository sessions, UserSessionRefreshTokenRepository refreshTokens,
                   AuthProperties properties, Clock clock, SecureRandom random) {
        this.sessions = sessions;
        this.refreshTokens = refreshTokens;
        this.properties = properties;
        this.clock = clock;
        this.random = random;
    }

    @Transactional
    SessionCredential create(User user) {
        return create(user, properties.refreshTokenLifetime());
    }

    /** A password session; staff sign-in passes the short restricted lifetime (D5). */
    @Transactional
    SessionCredential create(User user, Duration lifetime) {
        Instant now = clock.instant();
        return persist(new UserSession(UUID.randomUUID(), user, now, now.plus(lifetime)), now);
    }

    /**
     * Replaces an active restricted session with a new MFA-verified one that has the full refresh lifetime, so no
     * token issued before verification carries the new assurance. Runs in the caller's transaction.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    SessionCredential upgradeToMfa(UUID restrictedSessionId, UUID factorId) {
        UserSession restricted = sessions.findByIdForUpdate(restrictedSessionId)
                .orElseThrow(AuthenticationRequiredException::new);
        Instant now = clock.instant();
        if (restricted.revoked() || !restricted.expiresAt().isAfter(now)) throw new AuthenticationRequiredException();
        restricted.revoke(now, RevocationReason.MFA_VERIFIED);
        sessions.save(restricted);
        UserSession verified = new UserSession(UUID.randomUUID(), restricted.user(), now,
                now.plus(properties.refreshTokenLifetime()));
        verified.markMfaVerified(factorId, now);
        return persist(verified, now);
    }

    private SessionCredential persist(UserSession session, Instant now) {
        String rawToken = generateRefreshToken();
        sessions.save(session);
        refreshTokens.save(new UserSessionRefreshToken(UUID.randomUUID(), session, 0L,
                RefreshTokenHasher.hash(rawToken), now, session.expiresAt()));
        return credential(session, rawToken);
    }

    @Transactional(noRollbackFor = SessionReplayException.class)
    SessionCredential rotate(String presentedToken) {
        UserSessionRefreshToken current = refreshTokens.findByTokenHashForUpdate(RefreshTokenHasher.hash(presentedToken))
                .orElseThrow(AuthenticationRequiredException::new);
        UserSession session = sessions.findByIdForUpdate(current.session().id())
                .orElseThrow(AuthenticationRequiredException::new);
        Instant now = clock.instant();
        if (current.consumed()) {
            session.revoke(now, RevocationReason.REFRESH_REPLAY);
            sessions.save(session);
            throw new SessionReplayException();
        }
        if (session.revoked() || !session.expiresAt().isAfter(now) || !current.expiresAt().isAfter(now)) {
            throw new AuthenticationRequiredException();
        }
        current.consume(now);
        session.touch(now);
        String nextRawToken = generateRefreshToken();
        refreshTokens.save(current);
        refreshTokens.save(new UserSessionRefreshToken(UUID.randomUUID(), session, current.generation() + 1,
                RefreshTokenHasher.hash(nextRawToken), now, session.expiresAt()));
        return credential(session, nextRawToken);
    }

    /** Revokes the sessions of the presented refresh tokens; the lock query keeps it from deadlocking with a refresh. */
    @Transactional
    void revokeByRefreshTokens(List<String> presentedTokens, RevocationReason reason) {
        if (presentedTokens.isEmpty()) return;
        revokeAll(sessions.findByRefreshTokenHashesForUpdate(
                presentedTokens.stream().map(RefreshTokenHasher::hash).toList()), reason);
    }

    @Transactional
    void revoke(UUID sessionId, RevocationReason reason) {
        sessions.findByIdForUpdate(sessionId).ifPresent(session -> {
            session.revoke(clock.instant(), reason);
            sessions.save(session);
        });
    }

    /** Revokes every active session of a User; for later password recovery, role changes and account closure. */
    @Transactional
    void revokeAllForUser(UUID userId, RevocationReason reason) {
        revokeAll(sessions.findActiveByUserIdForUpdate(userId), reason);
    }

    /** The session's MFA evidence, when it belongs to the User and is neither revoked nor expired. */
    @Transactional(readOnly = true)
    MfaEvidence requireActive(UUID sessionId, UUID userId, Instant at) {
        UserSession session = sessions.findById(sessionId).orElseThrow(AuthenticationRequiredException::new);
        if (!userId.equals(session.user().id()) || session.revoked() || !session.expiresAt().isAfter(at)) {
            throw new AuthenticationRequiredException();
        }
        return new MfaEvidence(session.mfaFactorId(), session.mfaVerifiedAt());
    }

    private void revokeAll(List<UserSession> lockedSessions, RevocationReason reason) {
        Instant now = clock.instant();
        lockedSessions.forEach(session -> {
            session.revoke(now, reason);
            sessions.save(session);
        });
    }

    private String generateRefreshToken() {
        byte[] bytes = new byte[REFRESH_RANDOM_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static SessionCredential credential(UserSession session, String rawToken) {
        return new SessionCredential(session.user().id(), session.id(), rawToken, session.expiresAt(),
                new MfaEvidence(session.mfaFactorId(), session.mfaVerifiedAt()));
    }

    record SessionCredential(UUID userId, UUID sessionId, String refreshToken, Instant expiresAt, MfaEvidence mfa) {}

    /** Which factor verified the session and when; both null for a password-only session. */
    record MfaEvidence(UUID factorId, Instant verifiedAt) {}
}
