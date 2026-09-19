package bd.mediwish.auth;

import bd.mediwish.user.UserIdentifierNormalizer;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UserIdentifierNormalizerTest {
    private final UserIdentifierNormalizer normalizer = new UserIdentifierNormalizer();

    @Test
    void appliesTheLockedUsernameMobileAndEmailRules() {
        var normalized = normalizer.normalize("  Alice_1 ");

        assertThat(normalized.username()).isEqualTo("alice_1");
        assertThat(normalized.mobile()).isEqualTo("Alice_1");
        assertThat(normalized.email()).isEqualTo("alice_1");
        assertThat(normalizer.mobile(" +880 1700 ")).isEqualTo("+880 1700");
        assertThat(normalizer.email("  Alice@Example.COM ")).isEqualTo("alice@example.com");
        assertThat(normalizer.email("   ")).isNull();
    }
}
