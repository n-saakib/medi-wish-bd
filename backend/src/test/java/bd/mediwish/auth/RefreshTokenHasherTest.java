package bd.mediwish.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RefreshTokenHasherTest {
    @Test
    void returnsAStableLowercaseSha256HexDigest() {
        String hash = RefreshTokenHasher.hash("synthetic-refresh-token");

        assertThat(hash).hasSize(64).matches("[0-9a-f]{64}")
                .isEqualTo(RefreshTokenHasher.hash("synthetic-refresh-token"));
    }

    @Test
    void rejectsBlankRefreshValues() {
        assertThatThrownBy(() -> RefreshTokenHasher.hash(" "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
