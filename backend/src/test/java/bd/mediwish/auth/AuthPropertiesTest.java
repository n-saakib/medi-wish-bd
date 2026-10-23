package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AuthPropertiesTest {
    @Test
    void eachTokenLifetimeMustBeAtLeastOneSecond() {
        for (Duration invalid : new Duration[]{null, Duration.ZERO, Duration.ofSeconds(-1), Duration.ofMillis(999)}) {
            assertThatThrownBy(() -> properties(invalid, Duration.ofDays(30)))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("auth access-token lifetime must be at least one second");
            assertThatThrownBy(() -> properties(Duration.ofMinutes(15), invalid))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("auth refresh-token lifetime must be at least one second");
        }
        assertThat(properties(Duration.ofSeconds(1), Duration.ofSeconds(1)).accessTokenLifetime()).hasSeconds(1);
    }

    @Test
    void staffMfaSettingsAreRequiredAndBounded() {
        Duration second = Duration.ofSeconds(1);
        Duration tooShort = Duration.ofMillis(999);
        assertThatThrownBy(() -> new AuthProperties(Duration.ofMinutes(15), Duration.ofDays(30), "medi-wish",
                "medi-wish-api", "unused", new AuthProperties.Cookie(true), null, TestAuthSettings.recovery()))
                .hasMessage("auth MFA settings are required");
        assertThatThrownBy(() -> new AuthProperties.Mfa(" ", "key", second, second, 1, second, second))
                .hasMessage("auth MFA issuer is required");
        assertThatThrownBy(() -> new AuthProperties.Mfa("Medi Wish", "key", tooShort, second, 1, second, second))
                .hasMessage("auth MFA restricted-session lifetime must be at least one second");
        assertThatThrownBy(() -> new AuthProperties.Mfa("Medi Wish", "key", second, tooShort, 1, second, second))
                .hasMessage("auth MFA enrollment lifetime must be at least one second");
        assertThatThrownBy(() -> new AuthProperties.Mfa("Medi Wish", "key", second, second, 1, tooShort, second))
                .hasMessage("auth MFA attempt-window lifetime must be at least one second");
        assertThatThrownBy(() -> new AuthProperties.Mfa("Medi Wish", "key", second, second, 1, second, tooShort))
                .hasMessage("auth MFA lockout lifetime must be at least one second");
        assertThatThrownBy(() -> new AuthProperties.Mfa("Medi Wish", "key", second, second, 0, second, second))
                .hasMessage("auth MFA max-failed-attempts must be at least one");
        assertThat(new AuthProperties.Mfa("Medi Wish", "key", second, second, 1, second, second).maxFailedAttempts())
                .isOne();
    }

    @Test
    void recoveryKeysMustBeExactlyThirtyTwoBytesAndDistinctFromOtherSecrets() {
        for (String invalid : new String[]{null, "", "not base64!",
                java.util.Base64.getEncoder().encodeToString(new byte[31]),
                java.util.Base64.getEncoder().encodeToString(new byte[33])}) {
            assertThatThrownBy(() -> recovery(invalid))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("auth recovery code key must be Base64 of exactly 32 bytes");
        }
        assertThatThrownBy(() -> new AuthProperties(Duration.ofMinutes(15), Duration.ofDays(30), "medi-wish",
                "medi-wish-api", "unused", new AuthProperties.Cookie(true), TestAuthSettings.mfa(),
                recovery(TestAuthSettings.MFA_SECRET_KEY)))
                .hasMessage("auth recovery code key must differ from JWT and MFA keys");
    }

    @Test
    void codeAttemptLimitCannotExceedThePersistedFiveAttemptBound() {
        assertThatThrownBy(() -> new AuthProperties.Recovery(TestAuthSettings.RECOVERY_CODE_KEY,
                Duration.ofMinutes(15), 6, 5, Duration.ofHours(1), Duration.ofSeconds(60),
                10, Duration.ofHours(1), 5, Duration.ofHours(1)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void codeLifetimeIsFixedAtTheFifteenMinutesStatedInMailAndPageCopy() {
        for (Duration invalid : new Duration[]{null, Duration.ofSeconds(1), Duration.ofMinutes(14),
                Duration.ofMinutes(16)}) {
            assertThatThrownBy(() -> new AuthProperties.Recovery(TestAuthSettings.RECOVERY_CODE_KEY, invalid, 5, 5,
                    Duration.ofHours(1), Duration.ofSeconds(60), 10, Duration.ofHours(1), 5, Duration.ofHours(1)))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("auth recovery code-lifetime must be PT15M");
        }
        assertThat(recovery(TestAuthSettings.RECOVERY_CODE_KEY).codeLifetime()).isEqualTo(Duration.ofMinutes(15));
    }

    @Test
    void counterRetentionIsTwoHoursOrTheLongestConfiguredWindow() {
        assertThat(recovery(TestAuthSettings.RECOVERY_CODE_KEY).limitRetention()).isEqualTo(Duration.ofHours(2));
        assertThat(retention(Duration.ofHours(3), Duration.ofMinutes(1), Duration.ofHours(1), Duration.ofHours(1)))
                .isEqualTo(Duration.ofHours(3).plusMinutes(1));
        assertThat(retention(Duration.ofHours(1), Duration.ofMinutes(1), Duration.ofHours(4), Duration.ofHours(1)))
                .isEqualTo(Duration.ofHours(4));
        assertThat(retention(Duration.ofHours(1), Duration.ofMinutes(1), Duration.ofHours(1), Duration.ofHours(5)))
                .isEqualTo(Duration.ofHours(5));
    }

    private static Duration retention(Duration issue, Duration gap, Duration address, Duration password) {
        return new AuthProperties.Recovery(TestAuthSettings.RECOVERY_CODE_KEY, Duration.ofMinutes(15), 5, 5, issue,
                gap, 10, address, 5, password).limitRetention();
    }

    private static AuthProperties.Recovery recovery(String key) {
        return new AuthProperties.Recovery(key, Duration.ofMinutes(15), 5, 5, Duration.ofHours(1),
                Duration.ofSeconds(60), 10, Duration.ofHours(1), 5, Duration.ofHours(1));
    }

    private static AuthProperties properties(Duration access, Duration refresh) {
        return new AuthProperties(access, refresh, "medi-wish", "medi-wish-api", "unused", new AuthProperties.Cookie(true),
                TestAuthSettings.mfa(), TestAuthSettings.recovery());
    }
}
