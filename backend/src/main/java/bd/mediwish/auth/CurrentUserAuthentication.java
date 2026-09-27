package bd.mediwish.auth;

import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.Set;
import java.util.UUID;

/**
 * Resolves an access token to its current User: the session must be active, and the roles, the active authenticator
 * and the session's MFA evidence are read now, so the granted authorities follow every change at once.
 */
@Service
public class CurrentUserAuthentication {
    private final AccessTokenCodec accessTokens;
    private final SessionService sessions;
    private final UserRepository users;
    private final StaffMfaFactorRepository factors;
    private final Clock clock;

    CurrentUserAuthentication(AccessTokenCodec accessTokens, SessionService sessions,
                              UserRepository users, StaffMfaFactorRepository factors, Clock clock) {
        this.accessTokens = accessTokens;
        this.sessions = sessions;
        this.users = users;
        this.factors = factors;
        this.clock = clock;
    }

    public CurrentUser authenticate(String accessToken) {
        var claims = accessTokens.verify(accessToken);
        var evidence = sessions.requireActive(claims.sessionId(), claims.userId(), clock.instant());
        return users.findById(claims.userId())
                .filter(user -> PasswordVerifierPolicy.isUsable(user.passwordHash()))
                .map(user -> {
                    var access = StaffAccessPolicy.evaluate(user.roles(), factors.activeFactorIdOf(user),
                            evidence.factorId(), evidence.verifiedAt());
                    return new CurrentUser(user.id(), claims.sessionId(), UserProfile.from(user), user.roles(),
                            access.mfa(), access.authorities());
                })
                .orElseThrow(AuthenticationRequiredException::new);
    }

    /** The request's principal; {@code authorities} is what Spring Security checks. */
    public record CurrentUser(UUID userId, UUID sessionId, UserProfile profile, Set<UserRole> roles, MfaStatus mfa,
                              Set<String> authorities) {
        public CurrentUser {
            roles = Set.copyOf(roles);
            authorities = Set.copyOf(authorities);
        }
    }
}
