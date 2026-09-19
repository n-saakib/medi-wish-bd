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
public class SessionService {
    private static final int REFRESH_RANDOM_BYTES = 32;

    private final UserSessionRepository sessions;
    private final UserSessionRefreshTokenRepository refreshTokens;
    private final AuthProperties properties;
    private final Clock clock;
    private final SecureRandom random;

    public SessionService(UserSessionRepository sessions, UserSessionRefreshTokenRepository refreshTokens,
                          AuthProperties properties, Clock clock, SecureRandom random) {
        this.sessions = sessions;
        this.refreshTokens = refreshTokens;
        this.properties = properties;
        this.clock = clock;
        this.random = random;
    }

    @Transactional
    public SessionCredential create(User user) {
        Instant now = clock.instant();
        Instant expiresAt = now.plus(properties.refreshTokenLifetime());
        if (user == null || !expiresAt.isAfter(now)) throw new IllegalArgumentException("invalid session input");
        UserSession session = new UserSession(UUID.randomUUID(), user, now, expiresAt);
        String rawToken = generateRefreshToken();
        sessions.save(session);
        refreshTokens.save(new UserSessionRefreshToken(UUID.randomUUID(), session, 0L,
                RefreshTokenHasher.hash(rawToken), now, expiresAt));
        return new SessionCredential(user.id(), session.id(), rawToken, expiresAt);
    }

    @Transactional(noRollbackFor = SessionReplayException.class)
    public SessionCredential rotate(String presentedToken) {
        String hash = hashPresented(presentedToken);
        UserSessionRefreshToken current = refreshTokens.findByTokenHashForUpdate(hash)
                .orElseThrow(AuthenticationRequiredException::new);
        UserSession session = sessions.findByIdForUpdate(current.session().id())
                .orElseThrow(AuthenticationRequiredException::new);
        Instant now = clock.instant();
        if (current.consumed()) {
            session.revoke(now, "refresh-replay");
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
    public void revokeByRefreshToken(String presentedToken, String reason) {
        if (presentedToken == null || presentedToken.isBlank()) return;
        var current = refreshTokens.findByTokenHashForUpdate(RefreshTokenHasher.hash(presentedToken));
        if (current.isEmpty()) return;
        UserSession session = sessions.findByIdForUpdate(current.get().session().id()).orElse(null);
        if (session != null) {
            session.revoke(clock.instant(), boundedReason(reason));
            sessions.save(session);
        }
    }

    @Transactional
    public void revoke(UUID sessionId, String reason) {
        if (sessionId == null) return;
        sessions.findByIdForUpdate(sessionId).ifPresent(session -> {
            session.revoke(clock.instant(), boundedReason(reason));
            sessions.save(session);
        });
    }

    @Transactional
    public void revokeAllForUser(UUID userId, String reason) {
        if (userId == null) return;
        Instant now = clock.instant();
        sessions.findActiveByUserIdForUpdate(userId).forEach(session -> {
            session.revoke(now, boundedReason(reason));
            sessions.save(session);
        });
    }

    @Transactional(readOnly = true)
    public void requireActive(UUID sessionId, UUID userId, Instant at) {
        UserSession session = sessions.findById(sessionId).orElseThrow(AuthenticationRequiredException::new);
        if (session.user() == null || !userId.equals(session.user().id()) || session.revoked()
                || !session.expiresAt().isAfter(at)) throw new AuthenticationRequiredException();
    }

    private String hashPresented(String presentedToken) {
        if (presentedToken == null || presentedToken.isBlank()) throw new AuthenticationRequiredException();
        try {
            return RefreshTokenHasher.hash(presentedToken);
        } catch (IllegalArgumentException exception) {
            throw new AuthenticationRequiredException();
        }
    }

    private String generateRefreshToken() {
        byte[] bytes = new byte[REFRESH_RANDOM_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String boundedReason(String reason) {
        if (reason == null || reason.isBlank()) return "unspecified";
        return reason.length() <= 64 ? reason : reason.substring(0, 64);
    }

    public record SessionCredential(UUID userId, UUID sessionId, String refreshToken, Instant expiresAt) {}
}
