package bd.mediwish.auth;

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

    private static AuthProperties properties(Duration access, Duration refresh) {
        return new AuthProperties(access, refresh, "medi-wish", "medi-wish-api", "unused", new AuthProperties.Cookie(true));
    }
}
