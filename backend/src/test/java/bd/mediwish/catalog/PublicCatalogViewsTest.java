package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PublicCatalogViewsTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 19);

    @Test
    void percentageDiscountUsesCompactValueAndKeepsMoneyAtTwoPlaces() {
        var price = PublicCatalogViews.price(new EffectivePrice(UUID.randomUUID(), Money.parse("150"),
                Money.parse("160"), Money.parse("135"), new BigDecimal("15.00"), UUID.randomUUID(),
                DiscountTargetType.CATEGORY, DiscountKind.PERCENTAGE, new BigDecimal("10.00"), TODAY));

        assertThat(price).isEqualTo(new PublicPriceView("150.00", "160.00", "135.00", "15.00",
                new PublicDiscount(DiscountTargetType.CATEGORY, DiscountKind.PERCENTAGE, "10")));
    }

    @Test
    void flatDiscountKeepsTwoDecimalValue() {
        var price = PublicCatalogViews.price(new EffectivePrice(UUID.randomUUID(), Money.parse("100"), null,
                Money.parse("85"), new BigDecimal("15.00"), UUID.randomUUID(), DiscountTargetType.PRODUCT,
                DiscountKind.FLAT, new BigDecimal("15.00"), TODAY));

        assertThat(price).isEqualTo(new PublicPriceView("100.00", null, "85.00", "15.00",
                new PublicDiscount(DiscountTargetType.PRODUCT, DiscountKind.FLAT, "15.00")));
    }

    @Test
    void undiscountedPriceKeepsNullMrpAndDiscountAndTwoPlaceSaving() {
        var price = PublicCatalogViews.price(new EffectivePrice(UUID.randomUUID(), Money.parse("20"), null,
                Money.parse("20"), new BigDecimal("0.00"), null, null, null, null, TODAY));

        assertThat(price).isEqualTo(new PublicPriceView("20.00", null, "20.00", "0.00", null));
    }
}
