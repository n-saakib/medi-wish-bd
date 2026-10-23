package bd.mediwish.user;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class UserTest {
    @Test void onlyEmailChangesClearVerificationAndPasswordReplacementPreservesProfileAndRole() {
        User user = new User("email_owner", "01700000001", "owner@example.test", "old-verifier");
        assertThat(user.emailVerified()).isFalse();
        user.markEmailVerified(java.time.Instant.parse("2026-10-19T00:00:00Z"));
        user.updateProfile("Owner", "owner@example.test", null);
        assertThat(user.emailVerified()).isTrue();
        user.changePasswordHash("new-verifier");
        assertThat(user.passwordHash()).isEqualTo("new-verifier");
        assertThat(user.emailVerified()).isTrue();
        assertThat(user.fullName()).isEqualTo("Owner");
        assertThat(user.role()).isEqualTo(UserRole.CUSTOMER);
        assertThat(user.profileVersion()).isZero();
        user.updateProfile("Owner", "another@example.test", null);
        assertThat(user.emailVerified()).isFalse();
        user.markEmailVerified(java.time.Instant.parse("2026-10-19T00:00:01Z"));
        user.updateProfile("Owner", null, null);
        assertThat(user.emailVerified()).isFalse();
    }

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
        assertThat(user.rolesVersion()).isZero();
    }

    @Test
    void registrationAndReplacementAlwaysExposeExactlyOneRole() {
        var user = new User("role_customer", "01700000001", null, "synthetic");
        assertThat(user.role()).isEqualTo(UserRole.CUSTOMER);
        assertThat(user.rolesVersion()).isZero();
        user.replaceRole(UserRole.MODERATOR);
        assertThat(user.roles()).containsExactly(UserRole.MODERATOR);
        user.replaceRole(UserRole.MODERATOR);
        assertThat(user.roles()).containsExactly(UserRole.MODERATOR);
        assertThat(user.rolesVersion()).isZero();
        user.bumpRolesVersion();
        assertThat(user.rolesVersion()).isOne();
        user.replaceRole(UserRole.CUSTOMER);
        assertThat(user.hasStaffRole()).isFalse();
        assertThat(user.profileVersion()).isZero();
    }
}
