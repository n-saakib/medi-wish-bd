package bd.mediwish.auth;

import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.Set;

/** Resolves an access token to its current User: the session must be active and the roles are read now. */
@Service
public class CurrentUserAuthentication {
    private final AccessTokenCodec accessTokens;
    private final SessionService sessions;
    private final UserRepository users;
    private final Clock clock;

    CurrentUserAuthentication(AccessTokenCodec accessTokens, SessionService sessions,
                              UserRepository users, Clock clock) {
        this.accessTokens = accessTokens;
        this.sessions = sessions;
        this.users = users;
        this.clock = clock;
    }

    public CurrentUser authenticate(String accessToken) {
        var claims = accessTokens.verify(accessToken);
        sessions.requireActive(claims.sessionId(), claims.userId(), clock.instant());
        return users.findById(claims.userId())
                .filter(user -> PasswordVerifierPolicy.isUsable(user.passwordHash()))
                .map(user -> new CurrentUser(UserProfile.from(user), user.roles()))
                .orElseThrow(AuthenticationRequiredException::new);
    }

    public record CurrentUser(UserProfile profile, Set<UserRole> roles) {
        public CurrentUser {
            roles = Set.copyOf(roles);
        }
    }
}
