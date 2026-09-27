package bd.mediwish.auth;

import java.security.SecureRandom;
import java.util.LinkedHashSet;
import java.util.List;
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

    /** The value whose Argon2 verifier is stored: the code without its separator, for Ticket 09 to compare. */
    static String normalize(String code) {
        return code.replace("-", "");
    }
}
