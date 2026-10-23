package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import org.junit.jupiter.api.Test;
import java.time.Duration;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

class AccountCodeHasherTest {
    @Test void verifiersMatchAnIndependentHmacVectorAndSeparatePurposeIdCodeAndAddressDomains() {
        var recovery = new AuthProperties.Recovery("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", Duration.ofMinutes(15), 5, 5,
                Duration.ofHours(1), Duration.ofSeconds(60), 10, Duration.ofHours(1), 5, Duration.ofHours(1));
        var properties = new AuthProperties(Duration.ofMinutes(15), Duration.ofDays(30), "medi-wish",
                "medi-wish-api", "unused", new AuthProperties.Cookie(true), TestAuthSettings.mfa(), recovery);
        var hasher = new AccountCodeHasher(properties);
        UUID id = UUID.fromString("00000000-0000-0000-0000-000000000001");
        String hash = hasher.codeHash(AccountCodePurpose.PASSWORD_RESET, id, "042917");
        // The literal was calculated independently with Python's standard-library HMAC implementation.
        // Boolean comparisons keep verifiers out of assertion diagnostics.
        assertThat(hash.equals("33f99e1fefe2f9ec6ece51ac96448048ba81b34ef732a33351e00920b8dbd4c5")).isTrue();
        assertThat(hasher.matches(AccountCodePurpose.PASSWORD_RESET, id, "042917", hash)).isTrue();
        assertThat(hasher.matches(AccountCodePurpose.EMAIL_VERIFICATION, id, "042917", hash)).isFalse();
        assertThat(hasher.matches(AccountCodePurpose.PASSWORD_RESET, UUID.randomUUID(), "042917", hash)).isFalse();
        assertThat(hasher.matches(AccountCodePurpose.PASSWORD_RESET, id, "042918", hash)).isFalse();
        String address = hasher.addressKey("owner@example.test");
        assertThat(address.equals(hasher.addressKey("owner@example.test"))).isTrue();
        assertThat(address.contains("owner@example.test")).isFalse();
        assertThat(address.equals(hasher.addressKey("another@example.test"))).isFalse();
    }
}
