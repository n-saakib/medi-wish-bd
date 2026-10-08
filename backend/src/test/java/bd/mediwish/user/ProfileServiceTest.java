package bd.mediwish.user;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.web.StaleUpdateException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ProfileServiceTest {
    @Mock UserRepository users;
    @Mock MobileChangeRepository changes;
    private ProfileService service;
    private User user;

    @BeforeEach
    void setUp() {
        user = new User("alice_1", "01700000000", "alice@example.test", "encoded");
        service = new ProfileService(users, changes, new UserIdentifierNormalizer(),
                Clock.fixed(Instant.parse("2026-10-03T23:30:00Z"), ZoneOffset.UTC));
    }

    @Test
    void readsOneOwnerOnlyProjection() {
        ProfileView expected = ProfileView.from(user, null);
        when(users.findProfileById(user.id())).thenReturn(Optional.of(expected));

        assertThat(service.profile(user.id())).isEqualTo(expected);
        verifyNoInteractions(changes);
    }

    @Test
    void savesValidatedValuesAndTheDhakaDateBoundary() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        ProfileView saved = service.update(user.id(), new ProfileEdit("  Alice   Example ", " NEW@Example.test ",
                LocalDate.of(2026, 10, 4), 0L));

        assertThat(saved).isEqualTo(ProfileView.from(user, null));
        assertThat(saved).extracting(ProfileView::fullName, ProfileView::email, ProfileView::version)
                .containsExactly("Alice Example", "new@example.test", 1L);
        verify(users).flush();
    }

    @Test
    void aNormalizedNoOpWithAnOldVersionLeavesTheStoredVersionUntouched() {
        user.updateProfile("Alice Example", "alice@example.test", null);
        user.bumpProfileVersion();
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));

        ProfileView saved = service.update(user.id(), new ProfileEdit("  Alice   Example  ",
                "ALICE@EXAMPLE.TEST", null, 0L));

        assertThat(saved.version()).isEqualTo(1);
        verify(users, never()).flush();
    }

    @Test
    void aDifferentStaleSaveIsRefusedBeforeCheckingEmailOwnership() {
        user.bumpProfileVersion();
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> service.update(user.id(), new ProfileEdit("Stale", null, null, 0L)))
                .isInstanceOf(StaleUpdateException.class);
        verify(users, never()).existsByEmailIgnoreCaseAndIdNot(any(), any());
        assertThat(user.fullName()).isNull();
    }

    @Test
    void aTakenEmailIsRefusedWithoutChangingTheProfile() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(users.existsByEmailIgnoreCaseAndIdNot("taken@example.test", user.id())).thenReturn(true);

        assertThatThrownBy(() -> service.update(user.id(), new ProfileEdit(null, "taken@example.test", null, 0L)))
                .isInstanceOf(UserService.DuplicateUserException.class);
        assertThat(user.email()).isEqualTo("alice@example.test");
        assertThat(user.profileVersion()).isZero();
    }

    @Test
    void databaseUniquenessRaceIsReturnedAsDuplicateUser() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        doThrow(new DataIntegrityViolationException("unique", new SQLException("duplicate", "23505")))
                .when(users).flush();

        assertThatThrownBy(() -> service.update(user.id(), new ProfileEdit(null, "race@example.test", null, 0L)))
                .isInstanceOf(UserService.DuplicateUserException.class);
    }

    @Test
    void closingAccountIsRefusedBeforeValidationNoOpOrVersionChecks() {
        User closing = mock(User.class);
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(closing));
        when(closing.accountState()).thenReturn(AccountState.CLOSURE_REQUESTED);

        for (ProfileEdit edit : new ProfileEdit[]{
                new ProfileEdit("Invalid\nName", "invalid", null, -1L),
                new ProfileEdit(null, null, null, 0L),
                new ProfileEdit("Stale", null, null, 1L)}) {
            assertThatThrownBy(() -> service.update(user.id(), edit)).isInstanceOf(AccountClosingException.class);
        }

        verify(users, times(3)).findByIdForUpdate(user.id());
        verify(closing, times(3)).accountState();
        verifyNoMoreInteractions(users, closing);
        verifyNoInteractions(changes);
    }

    @Test
    void aMissingCallerCannotReadOrUpdateAProfile() {
        UUID missing = UUID.randomUUID();
        when(users.findProfileById(missing)).thenReturn(Optional.empty());
        when(users.findByIdForUpdate(missing)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.profile(missing)).isInstanceOf(AuthenticationRequiredException.class);
        assertThatThrownBy(() -> service.update(missing, new ProfileEdit(null, null, null, 0L)))
                .isInstanceOf(AuthenticationRequiredException.class);

        verify(users).findProfileById(missing);
        verify(users).findByIdForUpdate(missing);
        verifyNoMoreInteractions(users);
        verifyNoInteractions(changes);
    }
    @Test
    void aFutureDhakaDateIsRejectedEvenWhenUtcIsStillThePreviousDay() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> service.update(user.id(), new ProfileEdit(null, null,
                LocalDate.of(2026, 10, 5), 0L))).isInstanceOf(InvalidProfileException.class);
    }
}
