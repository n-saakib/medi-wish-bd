package bd.mediwish.address;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

class AddressRulesTest {
    private final AddressFields valid = new AddressFields("Home", "Demo Recipient", "01700000000", "House 1", "Dhaka");
    @Test void normalizesOptionalLabelsAndSpacesAfterCheckingTrimmedLength() {
        assertThat(AddressRules.validate(new AddressFields("  ", " Demo   Recipient ", " 01700000000 ", " House   1 ", " Dhaka ")))
                .isEqualTo(new AddressFields(null, "Demo Recipient", "01700000000", "House 1", "Dhaka"));
        assertThat(AddressRules.validate(new AddressFields(null, valid.recipientName(), valid.mobile(), valid.addressLine(), valid.city())).label()).isNull();
        assertThatThrownBy(() -> AddressRules.validate(new AddressFields("x" + " ".repeat(40) + "y", valid.recipientName(), valid.mobile(), valid.addressLine(), valid.city())))
                .isInstanceOf(InvalidAddressException.class);
    }
    @Test void rejectsMissingRequiredFieldsControlsAndOverlongFields() {
        for (String invalid : new String[]{null, "", "  ", "Demo\nRecipient", "\tDemo", "Demo\u2028Recipient", "Demo\u2029Recipient", "x".repeat(101)}) {
            assertThatThrownBy(() -> AddressRules.validate(new AddressFields(null, invalid, valid.mobile(), valid.addressLine(), valid.city())))
                    .isInstanceOf(InvalidAddressException.class);
        }
        for (String invalid : new String[]{null, "", "0170000000", "+8801700000000", "0170000000x", "০১৭০০০০০০০০"}) {
            assertThatThrownBy(() -> AddressRules.validate(new AddressFields(null, valid.recipientName(), invalid, valid.addressLine(), valid.city())))
                    .isInstanceOf(InvalidAddressException.class);
        }
        assertThatThrownBy(() -> AddressRules.validate(new AddressFields("x".repeat(41), valid.recipientName(), valid.mobile(), valid.addressLine(), valid.city()))).isInstanceOf(InvalidAddressException.class);
        assertThatThrownBy(() -> AddressRules.validate(new AddressFields(null, valid.recipientName(), valid.mobile(), "x".repeat(201), valid.city()))).isInstanceOf(InvalidAddressException.class);
        assertThatThrownBy(() -> AddressRules.validate(new AddressFields(null, valid.recipientName(), valid.mobile(), valid.addressLine(), "x".repeat(61)))).isInstanceOf(InvalidAddressException.class);
    }
    @Test void enforcesCapAndPreservesRepositorySuccessorOrderEvenForSignedUuidValues() {
        AddressRules.requireRoom(2);
        assertThatThrownBy(() -> AddressRules.requireRoom(3)).isInstanceOf(AddressBookFullException.class);
        var first = new SavedAddress(UUID.randomUUID(), UUID.fromString("00000000-0000-0000-0000-000000000001"), valid, false, Instant.EPOCH);
        var second = new SavedAddress(first.userId(), UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff"), valid, false, Instant.EPOCH);
        assertThat(AddressRules.successor(List.of(first, second))).contains(first);
        assertThat(AddressRules.successor(List.of())).isEmpty();
        assertThat(AddressRules.sameCreate(first, valid)).isTrue();
    }
    @Test void computesAllAcceptedDhakaWeekAndMonthBoundaries() {
        String[][] rows = {
                {"2026-10-11T17:59:59.999999Z", "2026-10-04T18:00:00Z", "2026-10-11T18:00:00Z", "2026-09-30T18:00:00Z", "2026-10-31T18:00:00Z"},
                {"2026-10-11T18:00:00Z", "2026-10-11T18:00:00Z", "2026-10-18T18:00:00Z", "2026-09-30T18:00:00Z", "2026-10-31T18:00:00Z"},
                {"2026-10-04T20:00:00Z", "2026-10-04T18:00:00Z", "2026-10-11T18:00:00Z", "2026-09-30T18:00:00Z", "2026-10-31T18:00:00Z"},
                {"2026-09-30T06:00:00Z", "2026-09-27T18:00:00Z", "2026-10-04T18:00:00Z", "2026-08-31T18:00:00Z", "2026-09-30T18:00:00Z"},
                {"2026-10-01T06:00:00Z", "2026-09-27T18:00:00Z", "2026-10-04T18:00:00Z", "2026-09-30T18:00:00Z", "2026-10-31T18:00:00Z"},
                {"2026-10-31T17:59:59.999999Z", "2026-10-25T18:00:00Z", "2026-11-01T18:00:00Z", "2026-09-30T18:00:00Z", "2026-10-31T18:00:00Z"},
                {"2026-10-31T18:00:00Z", "2026-10-25T18:00:00Z", "2026-11-01T18:00:00Z", "2026-10-31T18:00:00Z", "2026-11-30T18:00:00Z"},
                {"2026-12-31T18:00:00Z", "2026-12-27T18:00:00Z", "2027-01-03T18:00:00Z", "2026-12-31T18:00:00Z", "2027-01-31T18:00:00Z"}};
        for (String[] row : rows) assertThat(AddressRules.changeWindows(Instant.parse(row[0])))
                .isEqualTo(new AddressRules.ChangeWindows(Instant.parse(row[1]), Instant.parse(row[2]), Instant.parse(row[3]), Instant.parse(row[4])));
    }
    @Test void everyTextFieldHasItsOwnBoundsAndReplayIdentity() {
        String[] names = {"label", "recipientName", "mobile", "addressLine", "city"};
        String[] originals = {valid.label(), valid.recipientName(), valid.mobile(), valid.addressLine(), valid.city()};
        int[] lengths = {40, 100, 11, 200, 60};
        var stored = new SavedAddress(UUID.randomUUID(), UUID.randomUUID(), valid, true, Instant.EPOCH);
        for (int field = 0; field < names.length; field++) {
            int index = field;
            for (String bad : new String[]{"x\n", "x\u2028", "x\u2029", "x".repeat(lengths[field] + 1)}) {
                String[] values = originals.clone(); values[field] = bad;
                assertThatThrownBy(() -> AddressRules.validate(new AddressFields(values[0], values[1], values[2], values[3], values[4])))
                        .isInstanceOf(InvalidAddressException.class)
                        .satisfies(error -> assertThat(((InvalidAddressException) error).field()).isEqualTo(names[index]));
            }
            String[] changed = originals.clone(); changed[field] = "Different";
            assertThat(AddressRules.sameCreate(stored, new AddressFields(changed[0], changed[1], changed[2], changed[3], changed[4]))).isFalse();
            if (field > 0) {
                String[] missing = originals.clone(); missing[field] = null;
                assertThatThrownBy(() -> AddressRules.validate(new AddressFields(missing[0], missing[1], missing[2], missing[3], missing[4])))
                        .isInstanceOf(InvalidAddressException.class);
            }
        }
    }
    @Test void configuredLimitAllowanceMatchesEnforcementForEveryAcceptedPair() {
        long[][] counts = {{0,0}, {4,9}, {5,5}, {0,10}, {7,12}};
        var limits = new AddressRules.ChangeLimits(5,10);
        for (long[] pair : counts) {
            var allowance = AddressRules.allowance(pair[0], pair[1], limits);
            assertThat(allowance.remainingThisWeek()).isEqualTo((int) Math.max(0, 5 - pair[0]));
            assertThat(allowance.remainingThisMonth()).isEqualTo((int) Math.max(0, 10 - pair[1]));
            if (allowance.remainingThisWeek() == 0 || allowance.remainingThisMonth() == 0)
                assertThatThrownBy(() -> AddressRules.requireChangeAllowed(pair[0], pair[1], limits)).isInstanceOf(AddressChangeLimitException.class);
            else AddressRules.requireChangeAllowed(pair[0], pair[1], limits);
        }
        var small = new AddressRules.ChangeLimits(1,2);
        AddressRules.requireChangeAllowed(0,0,small);
        assertThatThrownBy(() -> AddressRules.requireChangeAllowed(1,1,small)).isInstanceOf(AddressChangeLimitException.class);
        assertThatThrownBy(() -> AddressRules.requireChangeAllowed(0,2,small)).isInstanceOf(AddressChangeLimitException.class);
        assertThat(AddressRules.allowance(0,1,small)).isEqualTo(new AddressRules.ChangeAllowance(1,2,1,1));
    }
    @Test void bothConfiguredLimitsApplyAndRemainingAllowanceClampsToZero() {
        var limits = new AddressRules.ChangeLimits(5, 10);
        AddressRules.requireChangeAllowed(4, 9, limits);
        assertThatThrownBy(() -> AddressRules.requireChangeAllowed(5, 0, limits)).isInstanceOf(AddressChangeLimitException.class);
        assertThatThrownBy(() -> AddressRules.requireChangeAllowed(0, 10, limits)).isInstanceOf(AddressChangeLimitException.class);
        assertThat(AddressRules.allowance(6, 12, limits)).isEqualTo(new AddressRules.ChangeAllowance(5, 10, 0, 0));
        assertThat(AddressRules.allowance(4, 8, limits)).isEqualTo(new AddressRules.ChangeAllowance(5, 10, 1, 2));
        assertThatThrownBy(() -> new AddressRules.ChangeLimits(0, 10)).hasMessageContaining("app.addresses.change-limits.per-week");
        assertThatThrownBy(() -> new AddressRules.ChangeLimits(5, 0)).hasMessageContaining("app.addresses.change-limits.per-month");
    }
}
