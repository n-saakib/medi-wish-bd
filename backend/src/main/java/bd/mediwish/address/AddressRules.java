package bd.mediwish.address;

import bd.mediwish.user.IdentifierFormats;
import java.time.*;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/** Pure address normalization, ordered default selection and Dhaka change allowances. */
public final class AddressRules {
    public static final int MAX_ADDRESSES = 3;
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cc}\\p{Zl}\\p{Zp}]");
    private static final ZoneId DHAKA = ZoneId.of("Asia/Dhaka");
    private AddressRules() {}

    public static AddressFields validate(AddressFields raw) {
        if (raw == null) throw new InvalidAddressException("address");
        String mobile = normalize(raw.mobile(), "mobile", 11, false);
        if (!IdentifierFormats.isMobile(mobile)) throw new InvalidAddressException("mobile");
        return new AddressFields(normalize(raw.label(), "label", 40, true),
                normalize(raw.recipientName(), "recipientName", 100, false), mobile,
                normalize(raw.addressLine(), "addressLine", 200, false), normalize(raw.city(), "city", 60, false));
    }

    private static String normalize(String raw, String field, int maximum, boolean optional) {
        if (raw == null) {
            if (optional) return null;
            throw new InvalidAddressException(field);
        }
        if (CONTROL.matcher(raw).find()) throw new InvalidAddressException(field);
        String trimmed = raw.trim();
        if (trimmed.length() > maximum || (!optional && trimmed.isEmpty())) throw new InvalidAddressException(field);
        return trimmed.isEmpty() ? null : trimmed.replaceAll(" +", " ");
    }

    public static void requireRoom(long count) {
        if (count >= MAX_ADDRESSES) throw new AddressBookFullException();
    }

    public static Optional<SavedAddress> successor(List<SavedAddress> remaining) {
        return remaining.stream().findFirst();
    }

    public static boolean sameCreate(SavedAddress stored, AddressFields fields) {
        return stored.fields().equals(fields);
    }

    public record ChangeLimits(int perWeek, int perMonth) {
        public ChangeLimits {
            if (perWeek < 1) throw new IllegalStateException("app.addresses.change-limits.per-week must be at least 1");
            if (perMonth < 1) throw new IllegalStateException("app.addresses.change-limits.per-month must be at least 1");
        }
    }
    public record ChangeWindows(Instant weekStart, Instant weekEnd, Instant monthStart, Instant monthEnd) {}
    public record ChangeAllowance(int perWeek, int perMonth, int remainingThisWeek, int remainingThisMonth) {}

    public static ChangeWindows changeWindows(Instant now) {
        LocalDate today = LocalDate.ofInstant(now, DHAKA);
        LocalDate week = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate month = today.withDayOfMonth(1);
        return new ChangeWindows(week.atStartOfDay(DHAKA).toInstant(), week.plusWeeks(1).atStartOfDay(DHAKA).toInstant(),
                month.atStartOfDay(DHAKA).toInstant(), month.plusMonths(1).atStartOfDay(DHAKA).toInstant());
    }
    public static void requireChangeAllowed(long inWeek, long inMonth, ChangeLimits limits) {
        if (inWeek >= limits.perWeek() || inMonth >= limits.perMonth()) throw new AddressChangeLimitException();
    }
    public static ChangeAllowance allowance(long inWeek, long inMonth, ChangeLimits limits) {
        return new ChangeAllowance(limits.perWeek(), limits.perMonth(),
                (int) Math.max(0L, limits.perWeek() - inWeek), (int) Math.max(0L, limits.perMonth() - inMonth));
    }
}
