package bd.mediwish.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** The {@code app.auth} settings; the JWT secret is validated where the codec builds its key. */
@ConfigurationProperties(prefix = "app.auth")
public record AuthProperties(Duration accessTokenLifetime, Duration refreshTokenLifetime, String issuer,
                             String audience, String jwtSecret, Cookie cookie) {
    public AuthProperties {
        requireAtLeastOneSecond(accessTokenLifetime, "access-token");
        requireAtLeastOneSecond(refreshTokenLifetime, "refresh-token");
    }

    /** {@code secure} may be false only under a local profile; SecurityConfiguration enforces it. */
    public record Cookie(boolean secure) {}

    private static void requireAtLeastOneSecond(Duration lifetime, String name) {
        if (lifetime == null || lifetime.toSeconds() < 1) {
            throw new IllegalStateException("auth " + name + " lifetime must be at least one second");
        }
    }
}
