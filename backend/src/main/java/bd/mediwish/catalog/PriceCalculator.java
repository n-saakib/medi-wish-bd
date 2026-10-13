package bd.mediwish.catalog;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

final class PriceCalculator {

    private PriceCalculator() {
    }

    private static final Comparator<Discount> TIES = Comparator
        .comparing((Discount d) -> d.targetType() == DiscountTargetType.PRODUCT ? 0 : 1)
        .thenComparing(Discount::startsOn)
        .thenComparing(d -> d.id().toString());

    static EffectivePrice price(UUID productId, UUID categoryId, Money sellingPrice, Money mrp,
            List<Discount> candidates, LocalDate today) {
        Objects.requireNonNull(sellingPrice);
        if (mrp != null && sellingPrice.compareTo(mrp) > 0)
            throw new IllegalArgumentException("Invalid catalog price");
        Discount winner = null;
        BigDecimal saving = BigDecimal.ZERO.setScale(2);
        for (Discount d : candidates) {
            boolean matches = d.targetType() == DiscountTargetType.PRODUCT ? productId.equals(d.productId())
                    : categoryId.equals(d.categoryId());
            if (!matches || d.status(today) != DiscountStatus.ACTIVE)
                continue;
            BigDecimal candidate = d.kind() == DiscountKind.FLAT ? d.value().setScale(2)
                    : sellingPrice.value().multiply(d.value()).movePointLeft(2).setScale(2, RoundingMode.HALF_UP);
            if (candidate.signum() <= 0 || candidate.compareTo(sellingPrice.value()) >= 0)
                continue;
            int greater = candidate.compareTo(saving);
            if (greater > 0 || greater == 0 && winner != null && TIES.compare(d, winner) < 0) {
                winner = d;
                saving = candidate;
            }
        }
        return new EffectivePrice(productId, sellingPrice, mrp,
                Money.parse(sellingPrice.value().subtract(saving).toPlainString()), saving,
                winner == null ? null : winner.id(), winner == null ? null : winner.targetType(),
                winner == null ? null : winner.kind(), winner == null ? null : winner.value(), today);
    }

}
