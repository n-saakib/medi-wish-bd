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
                "medi-wish-api", "unused", new AuthProperties.Cookie(true), null))
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

    private static AuthProperties properties(Duration access, Duration refresh) {
        return new AuthProperties(access, refresh, "medi-wish", "medi-wish-api", "unused", new AuthProperties.Cookie(true),
                TestAuthSettings.mfa());
    }
}
