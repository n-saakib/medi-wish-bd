package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserIdentifierNormalizer;
import bd.mediwish.user.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class AuthenticationService {
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final UserIdentifierNormalizer identifiers;
    private final SessionService sessions;
    private final AccessTokenCodec accessTokens;
    private final AuthProperties properties;

    public AuthenticationService(UserRepository users, PasswordEncoder passwords,
                                 UserIdentifierNormalizer identifiers, SessionService sessions,
                                 AccessTokenCodec accessTokens, AuthProperties properties) {
        this.users = users;
        this.passwords = passwords;
        this.identifiers = identifiers;
        this.sessions = sessions;
        this.accessTokens = accessTokens;
        this.properties = properties;
    }

    @Transactional
    public AuthenticatedSession signIn(String identifier, String password) {
        User user = resolve(identifier, password);
        if (user == null || !passwords.matches(password == null ? "" : password, user.passwordHash())) {
            throw new AuthenticationFailedException();
        }
        return issue(user, sessions.create(user));
    }

    public AuthenticatedSession refresh(String refreshToken) {
        SessionService.SessionCredential rotated = sessions.rotate(refreshToken);
        User user = users.findById(rotated.userId()).orElse(null);
        if (user == null || user.passwordHash() == null || user.passwordHash().isBlank()) {
            sessions.revoke(rotated.sessionId(), "user-unavailable");
            throw new AuthenticationRequiredException();
        }
        return issue(user, rotated);
    }

    public void logout(String refreshToken) {
        sessions.revokeByRefreshToken(refreshToken, "logout");
    }

    public void revokeAllForUser(UUID userId, String reason) {
        sessions.revokeAllForUser(userId, reason);
    }

    private User resolve(String rawIdentifier, String password) {
        var normalized = identifiers.normalize(rawIdentifier);
        Map<UUID, User> candidates = new LinkedHashMap<>();
        if (!normalized.username().isBlank()) users.findByUsername(normalized.username()).ifPresent(user -> candidates.put(user.id(), user));
        if (!normalized.mobile().isBlank()) users.findByMobileAndMobileVerifiedTrue(normalized.mobile())
                .ifPresent(user -> candidates.put(user.id(), user));
        if (normalized.email() != null) users.findAllByEmail(normalized.email())
                .forEach(user -> candidates.put(user.id(), user));
        if (candidates.size() != 1) {
            runDummyVerification(password == null ? "" : password);
            throw new AuthenticationFailedException();
        }
        return candidates.values().iterator().next();
    }

    private void runDummyVerification(String password) {
        String verifier = properties.dummyPasswordVerifier();
        if (verifier == null || verifier.isBlank()) throw new IllegalStateException("auth dummy verifier is not configured");
        passwords.matches(password, verifier);
    }

    private AuthenticatedSession issue(User user, SessionService.SessionCredential session) {
        var accessToken = accessTokens.issue(user.id(), session.sessionId());
        return new AuthenticatedSession(accessToken.token(), accessToken.expiresInSeconds(),
                session.refreshToken(), new UserProfile(user.username(), user.mobile(), user.email(), user.mobileVerified()));
    }

    public record AuthenticatedSession(String accessToken, long expiresIn, String refreshToken, UserProfile user) {}

    public record UserProfile(String username, String mobile, String email, boolean mobileVerified) {}
}
