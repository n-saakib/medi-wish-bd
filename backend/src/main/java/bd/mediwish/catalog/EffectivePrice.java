package bd.mediwish.catalog;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/** Immutable values to be copied, rather than joined, by later Order acceptance. */
public record EffectivePrice(UUID productId, Money sellingPrice, Money mrp, Money price, BigDecimal saving,
        UUID discountId, DiscountTargetType discountTarget, DiscountKind discountKind, BigDecimal discountValue,
        LocalDate pricedOn) {
}
