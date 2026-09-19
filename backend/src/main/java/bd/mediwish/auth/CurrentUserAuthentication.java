package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.Set;
import java.util.UUID;

@Service
public class CurrentUserAuthentication {
    private final AccessTokenCodec accessTokens;
    private final SessionService sessions;
    private final UserRepository users;
    private final Clock clock;

    public CurrentUserAuthentication(AccessTokenCodec accessTokens, SessionService sessions,
                                     UserRepository users, Clock clock) {
        this.accessTokens = accessTokens;
        this.sessions = sessions;
        this.users = users;
        this.clock = clock;
    }

    public CurrentUser authenticate(String accessToken) {
        AccessTokenCodec.AccessTokenClaims claims = accessTokens.verify(accessToken);
        return loadCurrent(claims.userId(), claims.sessionId());
    }

    public CurrentUser loadCurrent(UUID userId, UUID sessionId) {
        sessions.requireActive(sessionId, userId, clock.instant());
        User user = users.findById(userId)
                .filter(candidate -> candidate.passwordHash() != null && !candidate.passwordHash().isBlank())
                .orElseThrow(AuthenticationRequiredException::new);
        return new CurrentUser(user.id(), user.username(), user.mobile(), user.email(), user.mobileVerified(), user.roles());
    }

    public record CurrentUser(UUID id, String username, String mobile, String email,
                              boolean mobileVerified, Set<UserRole> roles) {
        public CurrentUser {
            roles = Set.copyOf(roles);
        }
    }
}
