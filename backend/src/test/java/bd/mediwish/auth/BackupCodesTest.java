package bd.mediwish.auth;

import org.junit.jupiter.api.Test;

import java.security.SecureRandom;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BackupCodesTest {
    @Test
    void parsesOnlyTheAcceptedAsciiAlphabetWithOptionalSpacesCaseAndOneSeparator() {
        for (String raw : new String[]{"abcd-2345", " ABCD 2345 ", "ABCD2345", "abcd-2345 ", "\tABCD-2345\n"}) {
            assertThat(BackupCodes.parse(raw)).isEqualTo("ABCD2345");
        }
        for (String raw : new String[]{null, "", "ABCD234", "ABCD23456", "ABCI2345", "ABCL2345", "ABCO2345",
                "ABCU2345", "ABC02345", "ABC12345", "ABCD--2345", "ABCD٢٣٤٥", "ＡBCD2345", "ABCß234",
                "ABCD\n2345", "ABCD\t2345", "ABCD 2345"}) {
            assertThatThrownBy(() -> BackupCodes.parse(raw)).isInstanceOf(InvalidRequestException.class)
                    .satisfies(error -> {
                        if (raw != null && !raw.isEmpty()) assertThat(String.valueOf(error.getMessage())).doesNotContain(raw);
                    });
        }
    }

    @Test
    void everyGeneratedCodeParsesToItsStoredVerifierInput() {
        var random = new SecureRandom();
        for (int batch = 0; batch < 100; batch++) {
            var codes = BackupCodes.generate(random);
            assertThat(codes).hasSize(10).doesNotHaveDuplicates();
            for (String code : codes) assertThat(BackupCodes.parse(code)).isEqualTo(BackupCodes.normalize(code));
        }
    }
}
