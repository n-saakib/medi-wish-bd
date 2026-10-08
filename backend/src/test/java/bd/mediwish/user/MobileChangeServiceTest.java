package bd.mediwish.user;

import bd.mediwish.auth.AuthenticationRequiredException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MobileChangeServiceTest {
    @Mock UserRepository users;
    @Mock MobileChangeRepository changes;
    private MobileChangeService service;
    private User user;

    @BeforeEach
    void setUp() {
        user = new User("alice_1", "01700000000", null, "encoded");
        service = new MobileChangeService(users, changes, new UserIdentifierNormalizer(),
                Clock.fixed(Instant.parse("2026-10-04T00:00:00Z"), ZoneOffset.UTC));
    }

    @Test
    void stagingReplacesThePendingChangeWithoutApplyingTheMobile() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(changes.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ProfileView first = service.stage(user.id(), " 01800000000 ");
        ProfileView second = service.stage(user.id(), "01900000000");

        assertThat(first.pendingMobile()).isEqualTo("01800000000");
        assertThat(second.pendingMobile()).isEqualTo("01900000000");
        assertThat(user.mobile()).isEqualTo("01700000000");
        assertThat(user.mobileVerified()).isFalse();
        var order = inOrder(users, changes);
        for (String mobile : new String[]{"01800000000", "01900000000"}) {
            order.verify(users).findByIdForUpdate(user.id());
            order.verify(users).existsByMobileAndIdNot(mobile, user.id());
            order.verify(changes).deleteByUserId(user.id());
            order.verify(changes).saveAndFlush(any(MobileChange.class));
        }
        order.verifyNoMoreInteractions();
    }

    @Test
    void aTakenMobileDoesNotReplaceThePendingChange() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(users.existsByMobileAndIdNot("01800000000", user.id())).thenReturn(true);

        assertThatThrownBy(() -> service.stage(user.id(), "01800000000"))
                .isInstanceOf(UserService.DuplicateUserException.class);
        verifyNoInteractions(changes);
    }

    @Test
    void activationRejectsAReplacedChangeWithoutApplyingIt() {
        MobileChange pending = new MobileChange(user.id(), "01800000000", Instant.now());
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(changes.findByUserId(user.id())).thenReturn(Optional.of(pending));

        assertThatThrownBy(() -> service.activate(user.id(), UUID.randomUUID()))
                .isInstanceOf(MobileChangeNotPendingException.class);
        assertThat(user.mobile()).isEqualTo("01700000000");
        verify(changes, never()).deleteByUserId(user.id());
    }

    @Test
    void activationAppliesOnlyTheMatchingPendingNumber() {
        MobileChange pending = new MobileChange(user.id(), "01800000000", Instant.now());
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(changes.findByUserId(user.id())).thenReturn(Optional.of(pending));

        service.activate(user.id(), pending.id());

        assertThat(user.mobile()).isEqualTo("01800000000");
        assertThat(user.mobileVerified()).isTrue();
        verify(changes).deleteByUserId(user.id());
    }

    @Test
    void activationUniqueCollisionDuringAutoFlushIsReturnedAsDuplicateUser() {
        MobileChange pending = new MobileChange(user.id(), "01800000000", Instant.now());
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(changes.findByUserId(user.id())).thenReturn(Optional.of(pending));
        when(changes.deleteByUserId(user.id()))
                .thenThrow(new DataIntegrityViolationException("unique", new SQLException("duplicate", "23505")));

        assertThatThrownBy(() -> service.activate(user.id(), pending.id()))
                .isInstanceOf(UserService.DuplicateUserException.class);
    }

    @Test
    void closingAccountRejectsEveryMobileMutationBeforeOtherRules() {
        User closing = mock(User.class);
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(closing));
        when(closing.accountState()).thenReturn(AccountState.CLOSURE_REQUESTED);

        assertThatThrownBy(() -> service.stage(user.id(), "invalid"))
                .isInstanceOf(AccountClosingException.class);
        assertThatThrownBy(() -> service.cancel(user.id())).isInstanceOf(AccountClosingException.class);
        assertThatThrownBy(() -> service.activate(user.id(), UUID.randomUUID()))
                .isInstanceOf(AccountClosingException.class);

        verify(users, times(3)).findByIdForUpdate(user.id());
        verify(closing, times(3)).accountState();
        verifyNoMoreInteractions(users, closing);
        verifyNoInteractions(changes);
    }

    @Test
    void aMissingCallerCannotStageCancelOrActivateAMobile() {
        UUID missing = UUID.randomUUID();
        when(users.findByIdForUpdate(missing)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.stage(missing, "01800000000"))
                .isInstanceOf(AuthenticationRequiredException.class);
        assertThatThrownBy(() -> service.cancel(missing)).isInstanceOf(AuthenticationRequiredException.class);
        assertThatThrownBy(() -> service.activate(missing, UUID.randomUUID()))
                .isInstanceOf(AuthenticationRequiredException.class);

        verify(users, times(3)).findByIdForUpdate(missing);
        verifyNoMoreInteractions(users);
        verifyNoInteractions(changes);
    }
    @Test
    void cancellingWithoutAPendingChangeIsIdempotent() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));

        service.cancel(user.id());

        verify(changes).deleteByUserId(user.id());
    }
}
