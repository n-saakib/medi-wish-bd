package bd.mediwish.address;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.user.*;
import bd.mediwish.web.StaleUpdateException;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AddressBookServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final SavedAddressRepository addresses = mock(SavedAddressRepository.class);
    private final Instant now = Instant.parse("2030-01-16T06:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final AddressBookService books = new AddressBookService(users, addresses, clock, new AddressChangeCalendar(clock), 5, 10);
    private final User user = new User("synthetic", "01700000000", null, "encoded");
    private final AddressFields fields = new AddressFields("Home", "Demo Recipient", "01700000000", "House 1", "Dhaka");
    private final List<SavedAddress> list = new ArrayList<>();
    @BeforeEach void setUp() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(addresses.findByUserIdOrderByCreatedAtAscIdAsc(user.id())).thenReturn(list);
    }
    private SavedAddress address(boolean isDefault) {
        var a = new SavedAddress(user.id(), UUID.randomUUID(), fields, isDefault, now); list.add(a); return a;
    }
    @Test void locksBeforeReadsAndChecksAllowanceBeforeAnyWrite() {
        UUID id = UUID.randomUUID();
        when(addresses.insertIfAbsent(eq(id), eq(user.id()), any(), any(), any(), any(), any(), eq(true), eq(now))).thenReturn(1);
        assertThat(books.create(user.id(), id, fields, false).created()).isTrue();
        var order = inOrder(users, addresses);
        var windows = AddressRules.changeWindows(now);
        order.verify(users).findByIdForUpdate(user.id());
        order.verify(addresses).findByUserIdOrderByCreatedAtAscIdAsc(user.id());
        order.verify(addresses).deleteChangesBefore(user.id(), windows.monthStart());
        order.verify(addresses).countChanges(user.id(), windows.weekStart(), windows.weekEnd());
        order.verify(addresses).countChanges(user.id(), windows.monthStart(), windows.monthEnd());
        order.verify(addresses).flush();
        order.verify(addresses).insertIfAbsent(eq(id), eq(user.id()), any(), any(), any(), any(), any(), eq(true), eq(now));
        verify(addresses).recordChange(any(), eq(user.id()), eq(now));
        verify(addresses, never()).save(any());
    }
    @Test void replayAndFullBookWinBeforeLimitsAndNeverWrite() {
        var target = address(true); address(false); address(false);
        assertThat(books.create(user.id(), target.id(), fields, false).created()).isFalse();
        assertThatThrownBy(() -> books.create(user.id(), UUID.randomUUID(), fields, false)).isInstanceOf(AddressBookFullException.class);
        assertThatThrownBy(() -> books.create(user.id(), target.id(), new AddressFields("Changed", fields.recipientName(), fields.mobile(), fields.addressLine(), fields.city()), true))
                .isInstanceOf(AddressIdConflictException.class);
        verify(addresses, never()).deleteChangesBefore(any(), any());
        verify(addresses, never()).flush();
    }
    @Test void identicalEditIgnoresVersionAndStaleEditWinsBeforeDefaultRuleAndLimit() {
        var target = address(true); target.bumpVersion();
        assertThat(books.update(user.id(), target.id(), fields, true, 0).items().getFirst().version()).isEqualTo(1);
        assertThatThrownBy(() -> books.update(user.id(), target.id(), fields, false, 0)).isInstanceOf(StaleUpdateException.class);
        assertThatThrownBy(() -> books.update(user.id(), target.id(), fields, false, 1)).isInstanceOf(InvalidAddressException.class);
        verify(addresses, never()).deleteChangesBefore(any(), any());
    }
    @Test void movingDefaultBumpsEachAffectedRowExactlyOnceAndRecordsOneChange() {
        var old = address(true); var next = address(false);
        var changed = new AddressFields("Office", fields.recipientName(), fields.mobile(), fields.addressLine(), fields.city());
        books.update(user.id(), next.id(), changed, true, 0);
        assertThat(old.isDefault()).isFalse(); assertThat(old.version()).isEqualTo(1);
        assertThat(next.isDefault()).isTrue(); assertThat(next.version()).isEqualTo(1);
        assertThat(next.fields()).isEqualTo(changed);
        verify(addresses).recordChange(any(), eq(user.id()), eq(now));
        verify(addresses, times(3)).flush();
    }
    @Test void deletePromotesRepositoryFirstRowAndNeverChecksOrConsumesAllowance() {
        var target = address(true); var next = address(false); address(false);
        books.delete(user.id(), target.id(), 0);
        assertThat(next.isDefault()).isTrue(); assertThat(next.version()).isEqualTo(1);
        verify(addresses).delete(target);
        verify(addresses, never()).deleteChangesBefore(any(), any());
        verify(addresses, never()).recordChange(any(), any(), any());
    }
    @Test void refusesLimitsWithoutChangingFieldsOrDefault() {
        var target = address(true);
        when(addresses.countChanges(any(), any(), any())).thenReturn(5L);
        assertThatThrownBy(() -> books.update(user.id(), target.id(), new AddressFields("Changed", fields.recipientName(), fields.mobile(), fields.addressLine(), fields.city()), true, 0))
                .isInstanceOf(AddressChangeLimitException.class);
        assertThat(target.fields()).isEqualTo(fields); assertThat(target.version()).isZero();
        verify(addresses, never()).flush();
    }
    @Test void closingAndMissingUsersRefuseBeforeReadingAddresses() {
        ReflectionTestUtils.setField(user, "accountState", AccountState.CLOSURE_REQUESTED);
        assertThatThrownBy(() -> books.create(user.id(), UUID.randomUUID(), null, false)).isInstanceOf(AccountClosingException.class);
        verifyNoInteractions(addresses);
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> books.delete(user.id(), UUID.randomUUID(), 0)).isInstanceOf(AuthenticationRequiredException.class);
    }
    @Test void defaultCreateFlushesDemotionBeforeInsertionAndZeroInsertionRefuses() {
        var old = address(true); UUID id = UUID.randomUUID();
        when(addresses.insertIfAbsent(eq(id), eq(user.id()), any(), any(), any(), any(), any(), eq(true), eq(now))).thenAnswer(invocation -> {
            assertThat(old.isDefault()).isFalse(); assertThat(old.version()).isEqualTo(1); return 1;
        });
        books.create(user.id(), id, fields, true);
        var order = inOrder(addresses);
        order.verify(addresses).findByUserIdOrderByCreatedAtAscIdAsc(user.id());
        order.verify(addresses).deleteChangesBefore(any(), any());
        var windows = AddressRules.changeWindows(now);
        order.verify(addresses).countChanges(user.id(), windows.weekStart(), windows.weekEnd());
        order.verify(addresses).countChanges(user.id(), windows.monthStart(), windows.monthEnd());
        order.verify(addresses).flush();
        order.verify(addresses).insertIfAbsent(eq(id), eq(user.id()), any(), any(), any(), any(), any(), eq(true), eq(now));
        when(addresses.insertIfAbsent(eq(id), eq(user.id()), any(), any(), any(), any(), any(), eq(false), eq(now))).thenReturn(0);
        assertThatThrownBy(() -> books.create(user.id(), id, fields, false)).isInstanceOf(AddressIdConflictException.class);
    }
    @Test void updateAndDeleteLockBeforeReadAndADeletedOnlyAddressLeavesNoSuccessor() {
        var only = address(true);
        books.update(user.id(), only.id(), fields, true, 0);
        var order = inOrder(users, addresses);
        order.verify(users).findByIdForUpdate(user.id());
        order.verify(addresses).findByUserIdOrderByCreatedAtAscIdAsc(user.id());
        clearInvocations(users, addresses);
        books.delete(user.id(), only.id(), 0);
        order = inOrder(users, addresses);
        order.verify(users).findByIdForUpdate(user.id());
        order.verify(addresses).findByUserIdOrderByCreatedAtAscIdAsc(user.id());
        order.verify(addresses).delete(only);
        assertThat(only.version()).isZero();
        verify(addresses, never()).recordChange(any(),any(),any());
    }
    @Test void everyCommandRefusesClosingAndDeletesCheckOwnedIdAndVersion() {
        ReflectionTestUtils.setField(user, "accountState", AccountState.CLOSURE_REQUESTED);
        assertThatThrownBy(() -> books.update(user.id(), UUID.randomUUID(), fields, false, 0)).isInstanceOf(AccountClosingException.class);
        assertThatThrownBy(() -> books.delete(user.id(), UUID.randomUUID(), 0)).isInstanceOf(AccountClosingException.class);
        verifyNoInteractions(addresses);
        ReflectionTestUtils.setField(user, "accountState", AccountState.ACTIVE);
        assertThatThrownBy(() -> books.delete(user.id(), UUID.randomUUID(), 0)).isInstanceOf(AddressNotFoundException.class);
        var target = address(false); target.bumpVersion();
        assertThatThrownBy(() -> books.delete(user.id(), target.id(), 0)).isInstanceOf(StaleUpdateException.class);
        verify(addresses, never()).delete(any());
    }
    @Test void missingOwnedTargetIsNotFoundAndReadOnlyBookIncludesClosingStateWithoutLockOrPrune() {
        assertThatThrownBy(() -> books.update(user.id(), UUID.randomUUID(), fields, false, 0)).isInstanceOf(AddressNotFoundException.class);
        clearInvocations(users, addresses);
        ReflectionTestUtils.setField(user, "accountState", AccountState.CLOSURE_REQUESTED);
        when(users.findById(user.id())).thenReturn(Optional.of(user));
        assertThat(books.book(user.id()).accountState()).isEqualTo("CLOSURE_REQUESTED");
        verify(users, never()).findByIdForUpdate(any());
        verify(addresses, never()).deleteChangesBefore(any(), any());
    }
}
