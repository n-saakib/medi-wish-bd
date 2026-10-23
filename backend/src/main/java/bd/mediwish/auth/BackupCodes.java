package bd.mediwish.auth;

import java.security.SecureRandom;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Single-use backup codes (D4): 10 codes of 8 characters without look-alikes, shown as {@code XXXX-XXXX}. */
final class BackupCodes {
    static final int COUNT = 10;
    private static final String ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
    private static final int LENGTH = 8;

    private BackupCodes() {}

    static List<String> generate(SecureRandom random) {
        Set<String> codes = new LinkedHashSet<>();
        while (codes.size() < COUNT) {
            StringBuilder code = new StringBuilder(LENGTH + 1);
            for (int i = 0; i < LENGTH; i++) {
                if (i == LENGTH / 2) code.append('-');
                code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
            }
            codes.add(code.toString());
        }
        return List.copyOf(codes);
    }

    /** Accepts only D4's ASCII alphabet, literal spaces and at most one separator. */
    static String parse(String raw) {
        if (raw == null || raw.chars().anyMatch(character -> character > 127)
                || raw.chars().filter(character -> character == '-').count() > 1) {
            throw new InvalidRequestException();
        }
        String code = raw.trim().replace(" ", "").replace("-", "").toUpperCase(Locale.ROOT);
        if (code.length() != LENGTH || code.chars().anyMatch(character -> ALPHABET.indexOf(character) < 0)) {
            throw new InvalidRequestException();
        }
        return code;
    }

    /** The value whose Argon2 verifier is stored: the code without its separator, for comparison during recovery. */
    static String normalize(String code) {
        return code.replace("-", "");
    }
}
