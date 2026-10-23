package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserIdentifierNormalizer;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
class AuthenticationService {
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final UserIdentifierNormalizer identifiers;
    private final SessionService sessions;
    private final AccessTokenCodec accessTokens;
    private final StaffMfaFactorRepository factors;
    private final Clock clock;
    // Unknown, ambiguous and unusable accounts are compared against this, so they fail as slowly as a wrong password.
    private final String dummyVerifier;

    AuthenticationService(UserRepository users, PasswordEncoder passwords, UserIdentifierNormalizer identifiers,
                          SessionService sessions, AccessTokenCodec accessTokens, StaffMfaFactorRepository factors,
                          Clock clock) {
        this.users = users;
        this.passwords = passwords;
        this.identifiers = identifiers;
        this.sessions = sessions;
        this.accessTokens = accessTokens;
        this.factors = factors;
        this.clock = clock;
        this.dummyVerifier = passwords.encode(UUID.randomUUID().toString());
    }

    // Not transactional: Argon2 verification must not hold a pooled connection; SessionService.create owns its transaction.
    AuthenticatedSession signIn(String identifier, String password) {
        User user = resolve(identifier).filter(candidate -> PasswordVerifierPolicy.isUsable(candidate.passwordHash()))
                .orElse(null);
        String verifiedPasswordHash = user == null ? dummyVerifier : user.passwordHash();
        boolean matches = passwords.matches(password, verifiedPasswordHash);
        if (user == null || !matches) throw new AuthenticationFailedException();
        var created = sessions.create(user.id(), verifiedPasswordHash);
        return issue(created.user(), created.credential());
    }

    AuthenticatedSession refresh(String refreshToken) {
        SessionService.SessionCredential rotated = sessions.rotate(refreshToken);
        User user = users.findById(rotated.userId())
                .filter(candidate -> PasswordVerifierPolicy.isUsable(candidate.passwordHash())).orElse(null);
        if (user == null) {
            sessions.revoke(rotated.sessionId(), RevocationReason.USER_UNAVAILABLE);
            throw new AuthenticationRequiredException();
        }
        return issue(user, rotated);
    }

    void logout(List<String> refreshTokens) {
        sessions.revokeByRefreshTokens(refreshTokens, RevocationReason.LOGOUT);
    }

    /** The one User the identifier names as username, verified mobile or email; empty when none or several match. */
    private Optional<User> resolve(String rawIdentifier) {
        var normalized = identifiers.normalize(rawIdentifier);
        Map<UUID, User> candidates = new LinkedHashMap<>();
        users.findByUsername(normalized.username()).ifPresent(user -> candidates.put(user.id(), user));
        users.findByMobileAndMobileVerifiedTrue(normalized.mobile()).ifPresent(user -> candidates.put(user.id(), user));
        // A null argument would become "email IS NULL" and match every User without an email.
        if (normalized.email() != null) {
            users.findByEmailIgnoreCase(normalized.email()).ifPresent(user -> candidates.put(user.id(), user));
        }
        return candidates.size() == 1 ? Optional.of(candidates.values().iterator().next()) : Optional.empty();
    }

    /** Issues an access token for the session with its current MFA status; also used after MFA verification. */
    AuthenticatedSession issue(User user, SessionService.SessionCredential session) {
        var accessToken = accessTokens.issue(user.id(), session.sessionId());
        var access = StaffAccessPolicy.evaluate(user.role(), factors.activeFactorIdOf(user),
                session.mfa().factorId(), session.mfa().verifiedAt(), session.mfa().replacingFactorId());
        // A restricted session can end before its access token would expire; report the earlier of the two.
        long expiresIn = Math.min(accessToken.expiresInSeconds(),
                Math.max(0, Duration.between(clock.instant(), session.expiresAt()).toSeconds()));
        return new AuthenticatedSession(accessToken.token(), expiresIn, session.refreshToken(), session.expiresAt(),
                UserProfile.from(user), access.mfa());
    }

    record AuthenticatedSession(String accessToken, long expiresIn, String refreshToken,
                                Instant refreshExpiresAt, UserProfile user, MfaStatus mfa) {}
}
