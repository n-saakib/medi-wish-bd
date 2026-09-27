package bd.mediwish.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.OptionalLong;

import static org.assertj.core.api.Assertions.assertThat;

class TotpTest {
    /** The RFC 6238 Appendix B SHA1 seed. */
    private static final byte[] SEED = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);
    private static final Instant NOW = Instant.ofEpochSecond(1_111_111_109L);
    private static final long NOW_STEP = Totp.step(NOW);

    @ParameterizedTest
    @CsvSource({"59, 287082", "1111111109, 081804", "1111111111, 050471", "1234567890, 005924",
            "2000000000, 279037", "20000000000, 353130"})
    void matchesTheRfc6238Sha1Vectors(long epochSecond, String expected) {
        assertThat(Totp.code(SEED, Totp.step(Instant.ofEpochSecond(epochSecond)))).isEqualTo(expected);
    }

    @Test
    void acceptsOneStepEitherSideAndNothingFurther() {
        assertThat(Totp.matchStep(SEED, Totp.code(SEED, NOW_STEP - 1), NOW, -1)).hasValue(NOW_STEP - 1);
        assertThat(Totp.matchStep(SEED, Totp.code(SEED, NOW_STEP), NOW, -1)).hasValue(NOW_STEP);
        assertThat(Totp.matchStep(SEED, Totp.code(SEED, NOW_STEP + 1), NOW, -1)).hasValue(NOW_STEP + 1);
        assertThat(Totp.matchStep(SEED, Totp.code(SEED, NOW_STEP - 2), NOW, -1)).isEmpty();
        assertThat(Totp.matchStep(SEED, Totp.code(SEED, NOW_STEP + 2), NOW, -1)).isEmpty();
    }

    @Test
    void anAcceptedCodeOrAnyOlderCodeIsNeverAcceptedAgain() {
        assertThat(Totp.matchStep(SEED, Totp.code(SEED, NOW_STEP), NOW, NOW_STEP)).isEmpty();
        assertThat(Totp.matchStep(SEED, Totp.code(SEED, NOW_STEP - 1), NOW, NOW_STEP)).isEmpty();
        assertThat(Totp.matchStep(SEED, Totp.code(SEED, NOW_STEP + 1), NOW, NOW_STEP)).hasValue(NOW_STEP + 1);
    }

    @Test
    void aCodeFromAnotherSeedIsRejected() {
        byte[] other = "09876543210987654321".getBytes(StandardCharsets.US_ASCII);
        OptionalLong matched = Totp.matchStep(SEED, Totp.code(other, NOW_STEP), NOW, -1);
        assertThat(matched).isEmpty();
    }
}
