package bd.mediwish.auth;

import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Defines the bounded shape of the Argon2 password verifiers persisted by the application.
 *
 * <p>The Ticket 02 profile (16 MiB) remains valid for persisted hashes; new hashes use the
 * 19 MiB profile from ADR-0019. This policy parses the verifier instead of matching a password,
 * so current-user and refresh authentication can reject corrupted credential state without
 * paying the password-hashing cost.</p>
 */
final class PasswordVerifierPolicy {
    private static final int SALT_BYTES = 16;
    private static final int HASH_BYTES = 32;
    private static final Pattern ARGON2_VERIFIER = Pattern.compile(
            "\\$argon2id\\$v=19\\$m=(?:16384|19456),t=2,p=1"
                    + "\\$([A-Za-z0-9+/]+={0,2})\\$([A-Za-z0-9+/]+={0,2})");

    private PasswordVerifierPolicy() {}

    /** Whether a persisted verifier has the bounded Argon2 structure this app writes; hashes nothing. */
    static boolean isUsable(String verifier) {
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
}
