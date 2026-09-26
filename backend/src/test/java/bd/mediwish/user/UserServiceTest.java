package bd.mediwish.user;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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
    void acceptsUsernameAtMinimumAndMaximumLengths() {
        UserService service = successfulRegistrationService();

        assertThat(service.register("abc", "01700000000", null, "a-very-long-password").username())
                .hasSize(3);
        assertThat(service.register("a".repeat(50), "01700000000", null, "a-very-long-password").username())
                .hasSize(50);
    }

    @Test
    void rejectsUsernameBelowMinimumLengthByItself() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("ab", "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsUsernameAboveMaximumLengthByItself() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("a".repeat(51), "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void acceptsPasswordAtMinimumAndMaximumLengths() {
        UserService service = successfulRegistrationService();

        assertThat(service.register("alice_1", "01700000000", null, "p".repeat(12)).passwordHash())
                .isEqualTo("encoded");
        assertThat(service.register("alice_1", "01700000000", null, "p".repeat(128)).passwordHash())
                .isEqualTo("encoded");
    }

    @Test
    void preservesLeadingAndTrailingWhitespaceInNonblankPassword() {
        String password = "  a-valid-password  ";
        when(passwords.encode(password)).thenReturn("encoded");
        when(users.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));

        User user = new UserService(users, passwords)
                .register("alice_1", "01700000000", null, password);

        assertThat(user.passwordHash()).isEqualTo("encoded");
        verify(passwords).encode(password);
    }

    @Test
    void rejectsPasswordBelowMinimumLengthByItself() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "01700000000", null, "p".repeat(11)))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsWhitespaceOnlyPasswordWithoutCheckingUniquenessOrEncoding() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "01700000000", null, " ".repeat(12)))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsPasswordAboveMaximumLengthByItself() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "01700000000", null, "p".repeat(129)))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsBlankMobileByItself() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "  \t ", null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void acceptsMobileAtMaximumLengthWithoutApplyingFormatRules() {
        UserService service = successfulRegistrationService();

        assertThat(service.register("alice_1", "1".repeat(30), null, "a-very-long-password").mobile())
                .hasSize(30);
    }

    @Test
    void rejectsMobileAboveMaximumLengthByItself() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "1".repeat(31), null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void acceptsOptionalEmailAtMaximumLengthUnderCurrentSyntaxRule() {
        String email = "a@" + "b".repeat(318);
        UserService service = successfulRegistrationService();

        assertThat(email).hasSize(320);
        assertThat(service.register("alice_1", "01700000000", email, "a-very-long-password").email())
                .isEqualTo(email);
    }

    @Test
    void rejectsMalformedOptionalEmailByItself() {
        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "01700000000", "not-an-email", "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsOptionalEmailAboveMaximumLengthByItself() {
        String email = "a@" + "b".repeat(319);
        assertThat(email).hasSize(321);

        assertThatThrownBy(() -> new UserService(users, passwords)
                .register("alice_1", "01700000000", email, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
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

    private UserService successfulRegistrationService() {
        when(passwords.encode(anyString())).thenReturn("encoded");
        when(users.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        return new UserService(users, passwords);
    }
}
