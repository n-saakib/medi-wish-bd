package bd.mediwish.user;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class UserTest {
    @Test
    void aProfileChangeAndMobileActivationKeepTheUsernameAndAdvanceOnlyTheProfileSaveVersion() {
        User user = new User("alice_1", "01700000000", "alice@example.test", "encoded");

        user.updateProfile("Alice Example", "new@example.test", LocalDate.of(1990, 5, 1));
        user.bumpProfileVersion();
        user.activateMobile("01800000000");

        assertThat(user.username()).isEqualTo("alice_1");
        assertThat(user.fullName()).isEqualTo("Alice Example");
        assertThat(user.email()).isEqualTo("new@example.test");
        assertThat(user.dateOfBirth()).isEqualTo(LocalDate.of(1990, 5, 1));
        assertThat(user.profileVersion()).isEqualTo(1);
        assertThat(user.accountState()).isEqualTo(AccountState.ACTIVE);
        assertThat(user.mobile()).isEqualTo("01800000000");
        assertThat(user.mobileVerified()).isTrue();
    }
}
