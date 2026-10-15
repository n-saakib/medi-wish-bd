package bd.mediwish.address;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.user.*;
import bd.mediwish.web.StaleUpdateException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/** Serializes each owner's mutations using the same User lock as profile and role changes. */
@Service
public class AddressBookService {
    private final UserRepository users;
    private final SavedAddressRepository addresses;
    private final Clock clock;
    private final AddressChangeCalendar calendar;
    private final AddressRules.ChangeLimits limits;

    public AddressBookService(UserRepository users, SavedAddressRepository addresses, Clock clock,
                              AddressChangeCalendar calendar,
                              @Value("${app.addresses.change-limits.per-week}") int perWeek,
                              @Value("${app.addresses.change-limits.per-month}") int perMonth) {
        this.users = users; this.addresses = addresses; this.clock = clock; this.calendar = calendar;
        this.limits = new AddressRules.ChangeLimits(perWeek, perMonth);
    }
    public record AddressBookCreation(AddressBookView book, boolean created) {}

    @Transactional(readOnly = true)
    public AddressBookView book(UUID userId) {
        User user = users.findById(userId).orElseThrow(AuthenticationRequiredException::new);
        return view(user, calendar.now());
    }

    @Transactional
    public AddressBookCreation create(UUID userId, UUID id, AddressFields raw, boolean isDefault) {
        User user = lock(userId);
        AddressFields fields = AddressRules.validate(raw);
        List<SavedAddress> list = addresses.findByUserIdOrderByCreatedAtAscIdAsc(userId);
        Instant now = calendar.now();
        SavedAddress existing = list.stream().filter(a -> a.id().equals(id)).findFirst().orElse(null);
        if (existing != null) {
            if (!AddressRules.sameCreate(existing, fields)) throw new AddressIdConflictException();
            return new AddressBookCreation(view(user, now), false);
        }
        AddressRules.requireRoom(list.size());
        requireChange(userId, now);
        boolean makeDefault = list.isEmpty() || isDefault;
        if (makeDefault) clearDefault(list);
        if (addresses.insertIfAbsent(id, userId, fields.label(), fields.recipientName(), fields.mobile(),
                fields.addressLine(), fields.city(), makeDefault, timestamp()) != 1) throw new AddressIdConflictException();
        addresses.flush();
        recordChange(userId, now);
        return new AddressBookCreation(view(user, now), true);
    }

    @Transactional
    public AddressBookView update(UUID userId, UUID id, AddressFields raw, boolean isDefault, long version) {
        User user = lock(userId);
        AddressFields fields = AddressRules.validate(raw);
        List<SavedAddress> list = addresses.findByUserIdOrderByCreatedAtAscIdAsc(userId);
        SavedAddress target = target(list, id);
        Instant now = calendar.now();
        if (target.fields().equals(fields) && target.isDefault() == isDefault) return view(user, now);
        if (target.version() != version) throw new StaleUpdateException();
        if (target.isDefault() && !isDefault) throw new InvalidAddressException("isDefault");
        requireChange(userId, now);
        if (isDefault && !target.isDefault()) clearDefault(list);
        target.edit(fields, timestamp());
        target.bumpVersion();
        if (isDefault) target.makeDefault();
        addresses.flush();
        recordChange(userId, now);
        return view(user, now);
    }

    @Transactional
    public AddressBookView delete(UUID userId, UUID id, long version) {
        User user = lock(userId);
        List<SavedAddress> list = addresses.findByUserIdOrderByCreatedAtAscIdAsc(userId);
        SavedAddress target = target(list, id);
        if (target.version() != version) throw new StaleUpdateException();
        addresses.delete(target);
        addresses.flush();
        if (target.isDefault()) {
            AddressRules.successor(list.stream().filter(a -> !a.id().equals(id)).toList()).ifPresent(next -> {
                next.makeDefault(); next.bumpVersion();
            });
            addresses.flush();
        }
        return view(user, calendar.now());
    }

    private User lock(UUID userId) {
        User user = users.findByIdForUpdate(userId).orElseThrow(AuthenticationRequiredException::new);
        if (user.accountState() != AccountState.ACTIVE) throw new AccountClosingException();
        return user;
    }
    private SavedAddress target(List<SavedAddress> list, UUID id) {
        return list.stream().filter(a -> a.id().equals(id)).findFirst().orElseThrow(AddressNotFoundException::new);
    }
    private Instant timestamp() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private void clearDefault(List<SavedAddress> list) {
        list.stream().filter(SavedAddress::isDefault).forEach(old -> { old.clearDefault(); old.bumpVersion(); });
        addresses.flush();
    }
    private void requireChange(UUID userId, Instant now) {
        var windows = AddressRules.changeWindows(now);
        addresses.deleteChangesBefore(userId, windows.weekStart().isBefore(windows.monthStart())
                ? windows.weekStart() : windows.monthStart());
        AddressRules.requireChangeAllowed(addresses.countChanges(userId, windows.weekStart(), windows.weekEnd()),
                addresses.countChanges(userId, windows.monthStart(), windows.monthEnd()), limits);
    }
    private void recordChange(UUID userId, Instant now) {
        addresses.recordChange(UUID.randomUUID(), userId, now);
        addresses.flush();
    }
    private AddressBookView view(User user, Instant now) {
        var windows = AddressRules.changeWindows(now);
        var allowance = AddressRules.allowance(addresses.countChanges(user.id(), windows.weekStart(), windows.weekEnd()),
                addresses.countChanges(user.id(), windows.monthStart(), windows.monthEnd()), limits);
        return AddressBookView.from(user, addresses.findByUserIdOrderByCreatedAtAscIdAsc(user.id()), allowance);
    }
}
