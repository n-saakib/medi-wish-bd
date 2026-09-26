package bd.mediwish.user;

import org.junit.jupiter.api.BeforeEach;
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
    private UserService service;

    @BeforeEach
    void setUp() {
        service = new UserService(users, passwords, new UserIdentifierNormalizer());
    }

    @Test
    void registersNormalizedUserWithCustomerRoleWithoutPersistingPlaintextPassword() {
        when(passwords.encode("a-very-long-password")).thenReturn("encoded");
        when(users.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        User user = service.register(" Alice_1 ", " 01700000000 ", " A@Example.com ", "a-very-long-password");

        assertThat(user.username()).isEqualTo("alice_1");
        assertThat(user.mobile()).isEqualTo("01700000000");
        assertThat(user.email()).isEqualTo("a@example.com");
        assertThat(user.passwordHash()).isEqualTo("encoded");
        assertThat(user.passwordHash()).doesNotContain("a-very-long-password");
        assertThat(user.roles()).containsExactly(UserRole.CUSTOMER);
        verify(passwords).encode("a-very-long-password");
    }

    @Test
    void aTakenUsernameIsRejected() {
        when(users.existsByUsername("alice_1")).thenReturn(true);

        assertThatThrownBy(() -> service.register("alice_1", "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.DuplicateUserException.class);
        verify(users, never()).saveAndFlush(any());
        verifyNoInteractions(passwords);
    }

    @Test
    void aTakenMobileIsRejected() {
        when(users.existsByMobile("01700000000")).thenReturn(true);

        assertThatThrownBy(() -> service.register("alice_1", "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.DuplicateUserException.class);
        verify(users, never()).saveAndFlush(any());
        verifyNoInteractions(passwords);
    }

    @Test
    void acceptsUsernameAtMinimumAndMaximumLengths() {
        stubSuccessfulRegistration();

        assertThat(service.register("abc", "01700000000", null, "a-very-long-password").username())
                .hasSize(3);
        assertThat(service.register("a".repeat(50), "01700000000", null, "a-very-long-password").username())
                .hasSize(50);
    }

    @Test
    void rejectsUsernameBelowMinimumLengthByItself() {
        assertThatThrownBy(() -> service.register("ab", "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsUsernameAboveMaximumLengthByItself() {
        assertThatThrownBy(() -> service.register("a".repeat(51), "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsAUsernameWithoutALetterSoItCanNeverEqualAMobile() {
        for (String username : new String[]{"01700000000", "123", "._-", "1.2_3"}) {
            assertThatThrownBy(() -> service.register(username, "01700000000", null, "a-very-long-password"))
                    .isInstanceOf(UserService.InvalidRegistrationException.class);
        }
        verifyNoInteractions(users, passwords);
    }

    @Test
    void acceptsAUsernameWithOneLetterAnywhere() {
        stubSuccessfulRegistration();

        for (String username : new String[]{"a12", "12a", "1.a", "01700000000x"}) {
            assertThat(service.register(username, "01700000000", null, "a-very-long-password").username())
                    .isEqualTo(username);
        }
    }

    @Test
    void rejectsUsernameCharactersOutsideTheAllowedSet() {
        for (String username : new String[]{"alice 1", "alice@1", "älice"}) {
            assertThatThrownBy(() -> service.register(username, "01700000000", null, "a-very-long-password"))
                    .isInstanceOf(UserService.InvalidRegistrationException.class);
        }
        verifyNoInteractions(users, passwords);
    }

    @Test
    void acceptsPasswordAtMinimumAndMaximumLengths() {
        stubSuccessfulRegistration();

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

        User user = service.register("alice_1", "01700000000", null, password);

        assertThat(user.passwordHash()).isEqualTo("encoded");
        verify(passwords).encode(password);
    }

    @Test
    void rejectsPasswordBelowMinimumLengthByItself() {
        assertThatThrownBy(() -> service.register("alice_1", "01700000000", null, "p".repeat(11)))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsWhitespaceOnlyPasswordWithoutCheckingUniquenessOrEncoding() {
        assertThatThrownBy(() -> service.register("alice_1", "01700000000", null, " ".repeat(12)))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsPasswordAboveMaximumLengthByItself() {
        assertThatThrownBy(() -> service.register("alice_1", "01700000000", null, "p".repeat(129)))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsBlankMobileByItself() {
        assertThatThrownBy(() -> service.register("alice_1", "  \t ", null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void acceptsMobileAtMaximumLengthWithoutApplyingFormatRules() {
        stubSuccessfulRegistration();

        assertThat(service.register("alice_1", "1".repeat(30), null, "a-very-long-password").mobile())
                .hasSize(30);
    }

    @Test
    void rejectsMobileAboveMaximumLengthByItself() {
        assertThatThrownBy(() -> service.register("alice_1", "1".repeat(31), null, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void acceptsOptionalEmailAtMaximumLengthUnderCurrentSyntaxRule() {
        String email = "a@" + "b".repeat(318);
        stubSuccessfulRegistration();

        assertThat(email).hasSize(320);
        assertThat(service.register("alice_1", "01700000000", email, "a-very-long-password").email())
                .isEqualTo(email);
    }

    @Test
    void rejectsMalformedOptionalEmailByItself() {
        assertThatThrownBy(() -> service.register("alice_1", "01700000000", "not-an-email", "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void rejectsOptionalEmailAboveMaximumLengthByItself() {
        String email = "a@" + "b".repeat(319);
        assertThat(email).hasSize(321);

        assertThatThrownBy(() -> service.register("alice_1", "01700000000", email, "a-very-long-password"))
                .isInstanceOf(UserService.InvalidRegistrationException.class);
        verifyNoInteractions(users, passwords);
    }

    @Test
    void treatsBlankEmailAsAbsent() {
        when(passwords.encode("a-very-long-password")).thenReturn("encoded");
        when(users.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));

        User user = service.register("alice_1", "01700000000", "   ", "a-very-long-password");

        assertThat(user.email()).isNull();
    }

    @Test
    void turnsBarePostgresSqlExceptionUniquenessRaceIntoBoundedDuplicateError() {
        when(users.saveAndFlush(any())).thenThrow(new org.springframework.dao.DataIntegrityViolationException(
                "unique", new java.sql.SQLException("duplicate key", "23505")));

        assertThatThrownBy(() -> service.register("alice_1", "01700000000", null, "a-very-long-password"))
                .isInstanceOf(UserService.DuplicateUserException.class);
    }

    @Test
    void rethrowsAnIntegrityViolationThatIsNotAUniquenessRace() {
        var violation = new org.springframework.dao.DataIntegrityViolationException(
                "check", new java.sql.SQLException("check violation", "23514"));
        when(users.saveAndFlush(any())).thenThrow(violation);

        assertThatThrownBy(() -> service.register("alice_1", "01700000000", null, "a-very-long-password"))
                .isSameAs(violation);
    }

    private void stubSuccessfulRegistration() {
        when(passwords.encode(anyString())).thenReturn("encoded");
        when(users.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
    }
}
