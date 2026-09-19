package bd.mediwish.user;

import org.springframework.stereotype.Component;

import java.util.Locale;

/**
 * The one normalization policy shared by registration and password login.
 * Mobile values are intentionally trimmed only until the final OTP ticket.
 */
@Component
public final class UserIdentifierNormalizer {
    public NormalizedIdentifier normalize(String rawIdentifier) {
        return new NormalizedIdentifier(username(rawIdentifier), mobile(rawIdentifier), email(rawIdentifier));
    }

    public String username(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    public String mobile(String value) {
        return value == null ? "" : value.trim();
    }

    public String email(String value) {
        return value == null || value.isBlank() ? null : value.trim().toLowerCase(Locale.ROOT);
    }

    public record NormalizedIdentifier(String username, String mobile, String email) {}
}
