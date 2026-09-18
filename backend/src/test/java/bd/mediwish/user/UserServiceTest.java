package bd.mediwish.user;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {
    @Mock UserRepository users;
    @Mock PasswordEncoder passwords;

    @Test
    void registersNormalizedUserWithCustomerRoleWithoutPersistingPlaintextPassword() {
        when(passwords.encode("a-very-long-password")).thenReturn("encoded");
        when(users.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        User user = new UserService(users, passwords)
                .register(" Alice_1 ", " 01700000000 ", " A@Example.com ", "a-very-long-password");

        assertThat(user.username()).isEqualTo("alice_1");
        assertThat(user.mobile()).isEqualTo("01700000000");
        assertThat(user.email()).isEqualTo("a@example.com");
        assertThat(user.passwordHash()).isEqualTo("encoded");
        assertThat(user.passwordHash()).doesNotContain("a-very-long-password");
        assertThat(user.roles()).containsExactly(UserRole.CUSTOMER);
        verify(passwords).encode("a-very-long-password");
    }

    @Test
    void rejectsDuplicateUsernameBeforeCheckingMobile() {
        when(users.existsByUsername("alice_1")).thenReturn(true);

        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.DuplicateUserException.class);
        verify(users, never()).existsByMobile(any());
        verify(users, never()).saveAndFlush(any());
        verifyNoInteractions(passwords);
    }

    @Test
    void rejectsDuplicateMobileBeforeEncodingPassword() {
        when(users.existsByMobile("01700000000")).thenReturn(true);

        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.DuplicateUserException.class);
        verify(users).existsByUsername("alice_1");
        verify(users).existsByMobile("01700000000");
        verify(users, never()).saveAndFlush(any());
        verifyNoInteractions(passwords);
    }

    @Test
    void rejectsInvalidRegistrationWithoutCallingPasswordEncoder() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("ab", "01700000000", null, "short"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(passwords);
    }

    @Test
    void rejectsOversizedMobileAndMalformedEmailAsInvalidInput() {
        var service = new UserService(users, passwords);

        assertThatThrownBy(() -> service.register("alice_1", "1".repeat(31), null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        assertThatThrownBy(() -> service.register("alice_1", "01700000000", "not-an-email", "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(passwords);
    }

    @Test
    void treatsBlankEmailAsAbsent() {
        when(passwords.encode("a-very-long-password")).thenReturn("encoded");
        when(users.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));

        User user = new UserService(users, passwords)
                .register("alice_1", "01700000000", "   ", "a-very-long-password");

        assertThat(user.email()).isNull();
    }

    @Test
    void turnsBarePostgresSqlExceptionUniquenessRaceIntoBoundedDuplicateError() {
        when(users.saveAndFlush(any())).thenThrow(new org.springframework.dao.DataIntegrityViolationException(
                "unique", new java.sql.SQLException("duplicate key", "23505")));

        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.DuplicateUserException.class);
    }
}
