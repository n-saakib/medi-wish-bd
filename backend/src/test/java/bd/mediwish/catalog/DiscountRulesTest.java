package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

class DiscountRulesTest {
    private final LocalDate today = LocalDate.of(2026, 10, 9);
    private Discount discount(LocalDate startsOn, LocalDate endsOn) {
        return new Discount(UUID.randomUUID(), DiscountTargetType.PRODUCT, UUID.randomUUID(),
                DiscountKind.PERCENTAGE, new BigDecimal("10.00"), startsOn, endsOn, null, Instant.EPOCH);
    }
    @Test void createRequiresTodayOrLaterAndAnInclusiveValidEnd() {
        assertThatThrownBy(() -> DiscountRules.create(DiscountKind.PERCENTAGE, BigDecimal.TEN,
                today.minusDays(1), null, today)).isInstanceOf(InvalidCatalogException.class);
        DiscountRules.create(DiscountKind.PERCENTAGE, BigDecimal.TEN, today, today, today);
        assertThatThrownBy(() -> DiscountRules.create(DiscountKind.PERCENTAGE, BigDecimal.TEN,
                today, today.minusDays(1), today)).isInstanceOf(InvalidCatalogException.class);
    }
    @Test void startedDiscountKeepsItsStartAndEndedDiscountCannotChange() {
        var running = discount(today.minusDays(1), null);
        assertThatThrownBy(() -> DiscountRules.update(running, DiscountKind.PERCENTAGE, BigDecimal.TEN,
                today, null, today)).isInstanceOf(InvalidCatalogException.class);
        var ended = discount(today.minusDays(2), today.minusDays(1));
        assertThatThrownBy(() -> DiscountRules.update(ended, DiscountKind.PERCENTAGE, BigDecimal.TEN,
                ended.startsOn(), null, today)).isInstanceOf(DiscountEndedException.class);
    }
    @Test void flatAmountMustBeStrictlyBelowTheCurrentSellingPrice() {
        assertThat(DiscountRules.exceedsPrice(DiscountKind.FLAT, BigDecimal.TEN, Money.parse("10"))).isTrue();
        assertThat(DiscountRules.exceedsPrice(DiscountKind.FLAT, BigDecimal.TEN, Money.parse("10.01"))).isFalse();
        assertThat(DiscountRules.exceedsPrice(DiscountKind.PERCENTAGE, BigDecimal.TEN, Money.parse("10"))).isFalse();
    }
    @ParameterizedTest @ValueSource(ints={0,100})
    void percentBoundsAreRefused(int value) {
        assertThatThrownBy(() -> DiscountRules.value(DiscountKind.PERCENTAGE, BigDecimal.valueOf(value)))
                .isInstanceOf(InvalidCatalogException.class);
    }
    @ParameterizedTest @ValueSource(ints={1,99})
    void wholePercentBoundsAreAccepted(int value) {
        DiscountRules.value(DiscountKind.PERCENTAGE, BigDecimal.valueOf(value));
    }
    @Test void replayComparesDecimalValueInsteadOfScale() {
        var stored = discount(today, null);
        assertThat(DiscountRules.same(stored, DiscountKind.PERCENTAGE, BigDecimal.TEN, today, null)).isTrue();
    }
}
