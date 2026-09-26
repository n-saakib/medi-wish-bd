package bd.mediwish.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mockito;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

class PasswordVerifierPolicyTest {
    private static final String VALID_VERIFIER =
            "$argon2id$v=19$m=16384,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private static final String CURRENT_VERIFIER =
            "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", " ", "not-an-argon2-verifier",
            "$argon2id$v=19$m=16384,t=2,p=1$bad$bad"})
    void rejectsNullBlankAndMalformedVerifierStates(String verifier) {
        assertThat(PasswordVerifierPolicy.isUsable(verifier)).isFalse();
    }

    @Test
    void acceptsTheBoundedArgon2VerifierShape() {
        assertThat(PasswordVerifierPolicy.isUsable(VALID_VERIFIER)).isTrue();
        assertThat(PasswordVerifierPolicy.isUsable(CURRENT_VERIFIER)).isTrue();
    }

    @Test
    void rejectsAlgorithmsVersionsUnsupportedCostsAndLengths() {
        String[] unsupportedVerifiers = {
                VALID_VERIFIER.replace("argon2id", "argon2i"),
                VALID_VERIFIER.replace("argon2id", "argon2d"),
                VALID_VERIFIER.replace("v=19", "v=16"),
                VALID_VERIFIER.replace("m=16384,t=2,p=1", "m=16383,t=2,p=1"),
                VALID_VERIFIER.replace("m=16384,t=2,p=1", "m=16385,t=2,p=1"),
                VALID_VERIFIER.replace("m=16384,t=2,p=1", "m=16384,t=3,p=1"),
                VALID_VERIFIER.replace("m=16384,t=2,p=1", "m=16384,t=2,p=2"),
                VALID_VERIFIER.replace("m=16384,t=2,p=1", "m=2147483647,t=2,p=1"),
                VALID_VERIFIER.replace("m=16384,t=2,p=1", "m=16384,t=2147483647,p=1"),
                VALID_VERIFIER.replace("m=16384,t=2,p=1", "m=16384,t=2,p=2048"),
                "$argon2id$v=19$m=16384,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAA"
        };

        for (String verifier : unsupportedVerifiers) {
            assertThat(PasswordVerifierPolicy.isUsable(verifier))
                    .as("a verifier shape not emitted by the configured encoder")
                    .isFalse();
        }
    }

    @Test
    void acceptsVerifierEmittedByTheConfiguredTicket02Encoder() {
        String verifier = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8()
                .encode("synthetic-verifier-policy-check");

        assertThat(PasswordVerifierPolicy.isUsable(verifier))
                .as("the configured Argon2id encoder output is accepted")
                .isTrue();
    }

    @Test
    void encoderAwareValidationUsesItsNonMatchingParserHook() {
        PasswordEncoder encoder = Mockito.mock(PasswordEncoder.class);

        assertThat(PasswordVerifierPolicy.isUsable(encoder, VALID_VERIFIER)).isTrue();

        verify(encoder).upgradeEncoding(VALID_VERIFIER);
        Mockito.verify(encoder, Mockito.never()).matches(Mockito.anyString(), Mockito.anyString());
    }
}
