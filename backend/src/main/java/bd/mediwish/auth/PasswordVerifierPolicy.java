package bd.mediwish.auth;

import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Defines the bounded shape of the Argon2 password verifiers persisted by the application.
 *
 * <p>The Ticket 02 profile (16 MiB) remains valid for persisted hashes; new hashes use the
 * 19 MiB profile from ADR-0019. This policy deliberately parses the verifier instead of matching
 * a password. Current-user and refresh authentication must be able to reject corrupted credential
 * state without paying the password-hashing cost, and startup validation can reuse the encoder-aware
 * overload.</p>
 */
public final class PasswordVerifierPolicy {
    private static final int MAX_VERIFIER_LENGTH = 255;
    private static final int SALT_BYTES = 16;
    private static final int HASH_BYTES = 32;
    private static final Pattern ARGON2_VERIFIER = Pattern.compile(
            "\\$argon2id\\$v=19\\$m=(?:16384|19456),t=2,p=1"
                    + "\\$([A-Za-z0-9+/]+={0,2})\\$([A-Za-z0-9+/]+={0,2})");

    private PasswordVerifierPolicy() {}

    /**
     * Returns whether a persisted verifier has the bounded Argon2 structure required by this app.
     * This method performs no password hashing and does not expose the verifier value.
     */
    public static boolean isUsable(String verifier) {
        if (verifier == null || verifier.isBlank() || verifier.length() > MAX_VERIFIER_LENGTH) {
            return false;
        }
        Matcher matcher = ARGON2_VERIFIER.matcher(verifier);
        if (!matcher.matches()) return false;
        try {
            byte[] salt = Base64.getDecoder().decode(matcher.group(1));
            byte[] hash = Base64.getDecoder().decode(matcher.group(2));
            return salt.length == SALT_BYTES && hash.length == HASH_BYTES;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    /**
     * Validates the structure and lets the configured encoder parse the verifier through its
     * non-matching upgrade-policy hook. The hook is intentionally not {@code matches}; callers
     * can use this at startup without performing a password-hash operation.
     */
    public static boolean isUsable(PasswordEncoder encoder, String verifier) {
        if (encoder == null || !isUsable(verifier)) return false;
        try {
            encoder.upgradeEncoding(verifier);
            return true;
        } catch (RuntimeException exception) {
            return false;
        }
    }
}
