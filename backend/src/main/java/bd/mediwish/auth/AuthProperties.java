package bd.mediwish.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** The {@code app.auth} settings; the JWT secret is validated where the codec builds its key. */
@ConfigurationProperties(prefix = "app.auth")
public record AuthProperties(Duration accessTokenLifetime, Duration refreshTokenLifetime, String issuer,
                             String audience, String jwtSecret, Cookie cookie, Mfa mfa) {
    public AuthProperties {
        requireAtLeastOneSecond(accessTokenLifetime, "access-token");
        requireAtLeastOneSecond(refreshTokenLifetime, "refresh-token");
        if (mfa == null) throw new IllegalStateException("auth MFA settings are required");
    }

    /** {@code secure} may be false only under a local profile; SecurityConfiguration enforces it. */
    public record Cookie(boolean secure) {}

    /**
     * Staff MFA (Ticket 06 D3, D5, D6). The secret key is validated where {@code MfaSecretCipher} builds its key.
     * The restricted lifetime bounds a password-only staff session; the enrollment lifetime bounds a pending seed.
     */
    public record Mfa(String issuer, String secretKey, Duration restrictedSessionLifetime, Duration enrollmentLifetime,
                      int maxFailedAttempts, Duration attemptWindow, Duration lockout) {
        public Mfa {
            if (issuer == null || issuer.isBlank()) throw new IllegalStateException("auth MFA issuer is required");
            requireAtLeastOneSecond(restrictedSessionLifetime, "MFA restricted-session");
            requireAtLeastOneSecond(enrollmentLifetime, "MFA enrollment");
            requireAtLeastOneSecond(attemptWindow, "MFA attempt-window");
            requireAtLeastOneSecond(lockout, "MFA lockout");
            if (maxFailedAttempts < 1) throw new IllegalStateException("auth MFA max-failed-attempts must be at least one");
        }
    }

    private static void requireAtLeastOneSecond(Duration lifetime, String name) {
        if (lifetime == null || lifetime.toSeconds() < 1) {
            throw new IllegalStateException("auth " + name + " lifetime must be at least one second");
        }
    }
}
