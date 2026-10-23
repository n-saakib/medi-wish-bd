package bd.mediwish.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** The {@code app.auth} settings; the JWT secret is validated where the codec builds its key. */
@ConfigurationProperties(prefix = "app.auth")
public record AuthProperties(Duration accessTokenLifetime, Duration refreshTokenLifetime, String issuer,
                             String audience, String jwtSecret, Cookie cookie, Mfa mfa, Recovery recovery) {
    public AuthProperties {
        requireAtLeastOneSecond(accessTokenLifetime, "access-token");
        requireAtLeastOneSecond(refreshTokenLifetime, "refresh-token");
        if (mfa == null) throw new IllegalStateException("auth MFA settings are required");
        if (recovery == null) throw new IllegalStateException("auth recovery settings are required");
        byte[] recoveryKey = decodeKey(recovery.codeKey());
        if (java.security.MessageDigest.isEqual(recoveryKey, decodeKey(jwtSecret))
                || java.security.MessageDigest.isEqual(recoveryKey, decodeKey(mfa.secretKey()))) {
            throw new IllegalStateException("auth recovery code key must differ from JWT and MFA keys");
        }
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

    /** Recovery limits use the accepted Ticket 05 defaults from application.yaml. */
    public record Recovery(String codeKey, Duration codeLifetime, int maxWrongTries, int issuesPerWindow,
                           Duration issueWindow, Duration issueGap, int addressRequestsPerWindow,
                           Duration addressWindow, int passwordAttemptsPerWindow, Duration passwordWindow) {
        static final Duration CODE_LIFETIME = Duration.ofMinutes(15);

        public Recovery {
            if (decodeKey(codeKey).length != 32) {
                throw new IllegalStateException("auth recovery code key must be Base64 of exactly 32 bytes");
            }
            // Mail bodies and the verification dialog state the accepted 15-minute lifetime.
            if (!CODE_LIFETIME.equals(codeLifetime)) {
                throw new IllegalStateException("auth recovery code-lifetime must be PT15M");
            }
            requireAtLeastOneSecond(issueWindow, "recovery issue-window");
            requireAtLeastOneSecond(issueGap, "recovery issue-gap");
            requireAtLeastOneSecond(addressWindow, "recovery address-window");
            requireAtLeastOneSecond(passwordWindow, "recovery password-window");
            if (maxWrongTries > 5) {
                throw new IllegalArgumentException("auth recovery max-wrong-tries must not exceed five");
            }
            if (maxWrongTries < 1 || issuesPerWindow < 1 || addressRequestsPerWindow < 1
                    || passwordAttemptsPerWindow < 1) {
                throw new IllegalStateException("auth recovery limits must be positive");
            }
        }

        /** Counters older than this are dead: two hours, or longer when a configured window needs it. */
        public Duration limitRetention() {
            Duration longest = Duration.ofHours(2);
            for (Duration window : new Duration[]{issueWindow.plus(issueGap), addressWindow, passwordWindow}) {
                if (window.compareTo(longest) > 0) longest = window;
            }
            return longest;
        }
        @Override public String toString() { return "Recovery[protected key]"; }
    }

    private static byte[] decodeKey(String value) {
        try { return java.util.Base64.getDecoder().decode(value == null ? "" : value.trim()); }
        catch (IllegalArgumentException invalid) { return new byte[0]; }
    }

    private static void requireAtLeastOneSecond(Duration lifetime, String name) {
        if (lifetime == null || lifetime.toSeconds() < 1) {
            throw new IllegalStateException("auth " + name + " lifetime must be at least one second");
        }
    }
}
