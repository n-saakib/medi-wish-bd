package bd.mediwish.auth;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Locale;
import java.util.OptionalLong;

/** RFC 6238 TOTP with HMAC-SHA1, 6 digits and 30-second steps, accepting one step either side (D2). */
final class Totp {
    static final long STEP_SECONDS = 30;
    private static final int WINDOW = 1;

    private Totp() {}

    static long step(Instant at) {
        return Math.floorDiv(at.getEpochSecond(), STEP_SECONDS);
    }

    static String code(byte[] seed, long step) {
        byte[] hash;
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(seed, "HmacSHA1"));
            hash = mac.doFinal(ByteBuffer.allocate(Long.BYTES).putLong(step).array());
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("HmacSHA1 is unavailable", exception);
        }
        int offset = hash[hash.length - 1] & 0x0f;
        int binary = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16)
                | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
        // Locale.ROOT keeps ASCII digits on a host whose default locale uses another script.
        return String.format(Locale.ROOT, "%06d", binary % 1_000_000);
    }

    /**
     * The earliest step in the window whose code equals {@code code} and is later than {@code lastUsedStep}, so an
     * accepted code, or any code older than it, can never be accepted again. Every candidate is compared.
     */
    static OptionalLong matchStep(byte[] seed, String code, Instant now, long lastUsedStep) {
        byte[] presented = code.getBytes(StandardCharsets.US_ASCII);
        long current = step(now);
        OptionalLong matched = OptionalLong.empty();
        for (long candidate = current - WINDOW; candidate <= current + WINDOW; candidate++) {
            boolean equal = MessageDigest.isEqual(presented, code(seed, candidate).getBytes(StandardCharsets.US_ASCII));
            if (equal && candidate > lastUsedStep && matched.isEmpty()) matched = OptionalLong.of(candidate);
        }
        return matched;
    }
}
