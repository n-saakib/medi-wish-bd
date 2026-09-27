package bd.mediwish.auth;

import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;

/** Encrypts authenticator seeds with AES-256-GCM; the factor id is the associated data, so a seed cannot move (D6). */
@Component
class MfaSecretCipher {
    private static final int KEY_BYTES = 32;
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec key;
    private final SecureRandom random;

    MfaSecretCipher(AuthProperties properties, SecureRandom random) {
        this.key = new SecretKeySpec(decodeKey(properties.mfa().secretKey()), "AES");
        this.random = random;
    }

    record Sealed(byte[] ciphertext, byte[] nonce) {}

    Sealed encrypt(UUID factorId, byte[] seed) {
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        return new Sealed(run(Cipher.ENCRYPT_MODE, factorId, nonce, seed), nonce);
    }

    /** Throws when the ciphertext, the nonce or the factor id was altered. */
    byte[] decrypt(UUID factorId, byte[] ciphertext, byte[] nonce) {
        return run(Cipher.DECRYPT_MODE, factorId, nonce, ciphertext);
    }

    private byte[] run(int mode, UUID factorId, byte[] nonce, byte[] input) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(mode, key, new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(ByteBuffer.allocate(16).putLong(factorId.getMostSignificantBits())
                    .putLong(factorId.getLeastSignificantBits()).array());
            return cipher.doFinal(input);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("authenticator seed could not be processed");
        }
    }

    private static byte[] decodeKey(String secretKey) {
        byte[] key;
        try {
            key = Base64.getDecoder().decode(secretKey == null ? "" : secretKey.trim());
        } catch (IllegalArgumentException exception) {
            // The cause is dropped because an invalid-character message would quote part of the key.
            key = new byte[0];
        }
        if (key.length != KEY_BYTES) throw new IllegalStateException("auth MFA secret key must be Base64 of exactly 32 bytes");
        return key;
    }
}
