package bd.mediwish.testsupport;

import bd.mediwish.auth.AuthProperties;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;

/** Synthetic staff MFA settings with the production defaults, for unit tests that build {@link AuthProperties}. */
public final class TestAuthSettings {
    /** Exactly 32 synthetic bytes, as AES-256 needs. */
    public static final String MFA_SECRET_KEY = Base64.getEncoder().encodeToString(
            "medi-wish-test-mfa-seed-key-0032".getBytes(StandardCharsets.UTF_8));

    private TestAuthSettings() {}

    /** The production lifetimes (15-minute access, 30-day refresh) with Secure cookies and {@link #mfa()}. */
    public static AuthProperties properties() {
        return new AuthProperties(Duration.ofMinutes(15), Duration.ofDays(30), "medi-wish", "medi-wish-api", "unused",
                new AuthProperties.Cookie(true), mfa());
    }

    public static AuthProperties.Mfa mfa() {
        return new AuthProperties.Mfa("Medi Wish", MFA_SECRET_KEY, Duration.ofMinutes(10), Duration.ofMinutes(10), 5,
                Duration.ofMinutes(15), Duration.ofMinutes(15));
    }
}
