package bd.mediwish.catalog;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;

final class DiscountRules {

    private DiscountRules() {
    }

    static void value(DiscountKind kind, BigDecimal value) {
        if (kind == null || value == null)
            throw new InvalidCatalogException("value");
        if (kind == DiscountKind.PERCENTAGE) {
            if (value.compareTo(BigDecimal.ONE) < 0 || value.compareTo(new BigDecimal("99")) > 0
                    || value.stripTrailingZeros().scale() > 0)
                throw new InvalidCatalogException("value");
        }
        else
            Money.parse(value.toPlainString());
    }

    static void create(DiscountKind kind, BigDecimal value, LocalDate startsOn, LocalDate endsOn, LocalDate today) {
        value(kind, value);
        if (startsOn == null || startsOn.isBefore(today) || endsOn != null && endsOn.isBefore(startsOn))
            throw new InvalidCatalogException("dates");
    }

    static void update(Discount stored, DiscountKind kind, BigDecimal value, LocalDate startsOn, LocalDate endsOn,
            LocalDate today) {
        if (stored.status(today) == DiscountStatus.ENDED)
            throw new DiscountEndedException();
        value(kind, value);
        if (startsOn == null
                || (stored.startsOn().isAfter(today) ? startsOn.isBefore(today) : !startsOn.equals(stored.startsOn()))
                || endsOn != null && endsOn.isBefore(startsOn.isAfter(today) ? startsOn : today))
            throw new InvalidCatalogException("dates");
    }

    static boolean exceedsPrice(DiscountKind kind, BigDecimal value, Money price) {
        return kind == DiscountKind.FLAT && price != null && value.compareTo(price.value()) >= 0;
    }

    static boolean same(Discount stored, DiscountKind kind, BigDecimal value, LocalDate startsOn, LocalDate endsOn) {
        return stored.kind() == kind && stored.value().compareTo(value) == 0 && stored.startsOn().equals(startsOn)
                && Objects.equals(stored.endsOn(), endsOn);
    }

}
