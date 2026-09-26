package bd.mediwish.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;

class PasswordVerifierPolicyTest {
    private static final String LEGACY_VERIFIER =
            "$argon2id$v=19$m=16384,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    @Test
    void acceptsTheLegacyTicket02AndCurrentProfiles() {
        assertThat(PasswordVerifierPolicy.isUsable(LEGACY_VERIFIER)).isTrue();
        assertThat(PasswordVerifierPolicy.isUsable(LEGACY_VERIFIER.replace("m=16384", "m=19456"))).isTrue();
        assertThat(PasswordVerifierPolicy.isUsable(
                Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode("synthetic-verifier-policy-check"))).isTrue();
        assertThat(PasswordVerifierPolicy.isUsable(
                new AuthCoreConfiguration().passwordEncoder().encode("synthetic-verifier-policy-check"))).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "not-an-argon2-verifier", "$argon2id$v=19$m=16384,t=2,p=1$bad$bad",
            "$argon2id$v=19$m=16384,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAA"})
    void rejectsBlankMalformedAndWrongLengthVerifiers(String verifier) {
        assertThat(PasswordVerifierPolicy.isUsable(verifier)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"argon2id>argon2i", "argon2id>argon2d", "v=19>v=16", "m=16384>m=16383", "m=16384>m=16385",
            "m=16384>m=2147483647", "t=2>t=3", "t=2>t=2147483647", "p=1>p=2", "p=1>p=2048"})
    void rejectsOtherAlgorithmsVersionsAndCosts(String replacement) {
        String[] change = replacement.split(">");

        assertThat(PasswordVerifierPolicy.isUsable(LEGACY_VERIFIER.replace(change[0], change[1]))).isFalse();
    }
}
