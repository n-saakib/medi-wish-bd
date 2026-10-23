package bd.mediwish.user;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PasswordPolicyTest {
    @Test void registrationAndRecoveryShareTheExistingExactPasswordBounds() {
        assertThat(UserService.isAcceptablePassword(null)).isFalse();
        assertThat(UserService.isAcceptablePassword("      ")).isFalse();
        assertThat(UserService.isAcceptablePassword("x".repeat(5))).isFalse();
        assertThat(UserService.isAcceptablePassword("x".repeat(6))).isTrue();
        assertThat(UserService.isAcceptablePassword("x".repeat(30))).isTrue();
        assertThat(UserService.isAcceptablePassword("x".repeat(31))).isFalse();
        assertThat(UserService.isAcceptablePassword(" abcde")).isTrue();
        assertThat(UserService.isAcceptablePassword("abcde ")).isTrue();
    }
}
