package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MfaSecretCipherTest {
    private static final byte[] SEED = "synthetic-seed-20-by".getBytes(StandardCharsets.US_ASCII);
    private final MfaSecretCipher cipher = new MfaSecretCipher(TestAuthSettings.properties(), new SecureRandom());

    @Test
    void aSealedSeedOpensOnlyForItsOwnFactor() {
        UUID factorId = UUID.randomUUID();
        var sealed = cipher.encrypt(factorId, SEED);

        assertThat(new String(sealed.ciphertext(), StandardCharsets.ISO_8859_1))
                .doesNotContain(new String(SEED, StandardCharsets.US_ASCII));
        assertThat(cipher.decrypt(factorId, sealed.ciphertext(), sealed.nonce())).isEqualTo(SEED);
        assertThatThrownBy(() -> cipher.decrypt(UUID.randomUUID(), sealed.ciphertext(), sealed.nonce()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void anAlteredCiphertextOrNonceIsRejected() {
        UUID factorId = UUID.randomUUID();
        var sealed = cipher.encrypt(factorId, SEED);
        byte[] ciphertext = sealed.ciphertext().clone();
        ciphertext[0] ^= 1;
        byte[] nonce = sealed.nonce().clone();
        nonce[0] ^= 1;

        assertThatThrownBy(() -> cipher.decrypt(factorId, ciphertext, sealed.nonce()))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> cipher.decrypt(factorId, sealed.ciphertext(), nonce))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void everySealUsesAFreshNonce() {
        UUID factorId = UUID.randomUUID();
        assertThat(cipher.encrypt(factorId, SEED).nonce()).isNotEqualTo(cipher.encrypt(factorId, SEED).nonce());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not base64!", "c2hvcnQ=", "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEy"})
    void startupFailsWithoutAKeyOfExactly32BytesAndNeverQuotesIt(String key) {
        var mfa = TestAuthSettings.mfa();
        var settings = new AuthProperties.Mfa(mfa.issuer(), key, mfa.restrictedSessionLifetime(),
                mfa.enrollmentLifetime(), mfa.maxFailedAttempts(), mfa.attemptWindow(), mfa.lockout());
        var properties = new AuthProperties(Duration.ofMinutes(15), Duration.ofDays(30), "medi-wish", "medi-wish-api",
                "unused", new AuthProperties.Cookie(true), settings, TestAuthSettings.recovery());

        assertThatThrownBy(() -> new MfaSecretCipher(properties, new SecureRandom()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth MFA secret key must be Base64 of exactly 32 bytes")
                .hasNoCause();
    }

    @Test
    void theTestKeyIsExactly32Bytes() {
        assertThat(Base64.getDecoder().decode(TestAuthSettings.MFA_SECRET_KEY)).hasSize(32);
    }
}
