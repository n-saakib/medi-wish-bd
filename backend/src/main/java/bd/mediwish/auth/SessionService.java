package bd.mediwish.auth;

import bd.mediwish.user.User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
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
        Instant now = clock.instant();
        Instant expiresAt = now.plus(properties.refreshTokenLifetime());
        UserSession session = new UserSession(UUID.randomUUID(), user, now, expiresAt);
        String rawToken = generateRefreshToken();
        sessions.save(session);
        refreshTokens.save(new UserSessionRefreshToken(UUID.randomUUID(), session, 0L,
                RefreshTokenHasher.hash(rawToken), now, expiresAt));
        return new SessionCredential(user.id(), session.id(), rawToken, expiresAt);
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
        return new SessionCredential(session.user().id(), session.id(), nextRawToken, session.expiresAt());
    }

    @Transactional
    void revokeByRefreshToken(String presentedToken, RevocationReason reason) {
        refreshTokens.findByTokenHashForUpdate(RefreshTokenHasher.hash(presentedToken))
                .ifPresent(current -> revoke(current.session().id(), reason));
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
        Instant now = clock.instant();
        sessions.findActiveByUserIdForUpdate(userId).forEach(session -> {
            session.revoke(now, reason);
            sessions.save(session);
        });
    }

    @Transactional(readOnly = true)
    void requireActive(UUID sessionId, UUID userId, Instant at) {
        UserSession session = sessions.findById(sessionId).orElseThrow(AuthenticationRequiredException::new);
        if (!userId.equals(session.user().id()) || session.revoked() || !session.expiresAt().isAfter(at)) {
            throw new AuthenticationRequiredException();
        }
    }

    private String generateRefreshToken() {
        byte[] bytes = new byte[REFRESH_RANDOM_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    record SessionCredential(UUID userId, UUID sessionId, String refreshToken, Instant expiresAt) {}
}
