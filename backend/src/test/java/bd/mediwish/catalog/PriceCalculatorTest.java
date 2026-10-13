package bd.mediwish.catalog;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import static org.assertj.core.api.Assertions.*;

class PriceCalculatorTest {
    static final UUID PRODUCT = UUID.fromString("11111111-1111-4111-8111-111111111111");
    static final UUID CATEGORY = UUID.fromString("22222222-2222-4222-8222-222222222222");
    static final LocalDate TODAY = LocalDate.of(2026, 10, 9);
    static Discount candidate(String id, DiscountTargetType target, DiscountKind kind, String value,
            LocalDate start, LocalDate end) {
        return new Discount(UUID.fromString(id), target, target == DiscountTargetType.PRODUCT ? PRODUCT : CATEGORY,
                kind, new BigDecimal(value), start, end, null, Instant.EPOCH);
    }
    static Discount percent(DiscountTargetType target, String value) {
        return candidate("00000000-0000-4000-8000-000000000001", target, DiscountKind.PERCENTAGE, value, TODAY, null);
    }
    static Stream<Object[]> workedExamples() {
        var p10 = percent(DiscountTargetType.PRODUCT, "10");
        var c10 = percent(DiscountTargetType.CATEGORY, "10");
        var c15 = percent(DiscountTargetType.CATEGORY, "15");
        var flat20 = candidate("00000000-0000-4000-8000-000000000003", DiscountTargetType.PRODUCT, DiscountKind.FLAT, "20", TODAY, null);
        var window = candidate("00000000-0000-4000-8000-000000000001", DiscountTargetType.PRODUCT, DiscountKind.PERCENTAGE, "10", TODAY.plusDays(1), TODAY.plusDays(3));
        var ended = percent(DiscountTargetType.PRODUCT, "10"); ended.end(null, Instant.EPOCH);
        var older = candidate("00000000-0000-4000-8000-000000000002", DiscountTargetType.PRODUCT, DiscountKind.PERCENTAGE, "10", TODAY.minusDays(8), null);
        var newer = candidate("00000000-0000-4000-8000-000000000001", DiscountTargetType.PRODUCT, DiscountKind.PERCENTAGE, "10", TODAY.minusDays(4), null);
        var highId = candidate("80000000-0000-4000-8000-000000000000", DiscountTargetType.PRODUCT, DiscountKind.PERCENTAGE, "10", TODAY, null);
        var categoryTie = candidate("00000000-0000-4000-8000-000000000001", DiscountTargetType.CATEGORY, DiscountKind.FLAT, "20", TODAY.minusDays(8), null);
        var productTie = candidate("00000000-0000-4000-8000-000000000002", DiscountTargetType.PRODUCT, DiscountKind.PERCENTAGE, "10", TODAY.minusDays(4), null);
        return Stream.of(
            new Object[]{1,"150.00","150.00",List.of(p10,c15),TODAY,"127.50",c15},
            new Object[]{2,"150.00",null,List.of(flat20,c10),TODAY,"130.00",flat20},
            new Object[]{3,"200.00",null,List.of(categoryTie,productTie),TODAY,"180.00",productTie},
            new Object[]{4,"123.45",null,List.of(c10),TODAY,"111.10",c10},
            new Object[]{5,"0.05",null,List.of(percent(DiscountTargetType.PRODUCT,"50")),TODAY,"0.02",percent(DiscountTargetType.PRODUCT,"50")},
            new Object[]{6,"0.01",null,List.of(percent(DiscountTargetType.PRODUCT,"99")),TODAY,"0.01",null},
            new Object[]{7,"10.00",null,List.of(candidate("00000000-0000-4000-8000-000000000001",DiscountTargetType.PRODUCT,DiscountKind.FLAT,"10",TODAY,null)),TODAY,"10.00",null},
            new Object[]{8,"100.00",null,List.of(window),TODAY,"100.00",null},
            new Object[]{9,"100.00",null,List.of(window),TODAY.plusDays(1),"90.00",window},
            new Object[]{10,"100.00",null,List.of(window),TODAY.plusDays(3),"90.00",window},
            new Object[]{11,"100.00",null,List.of(window),TODAY.plusDays(4),"100.00",null},
            new Object[]{12,"100.00",null,List.of(ended),TODAY,"100.00",null},
            new Object[]{13,"160.00","150.00",List.of(p10),TODAY,null,null},
            new Object[]{14,"123.44",null,List.of(c10),TODAY,"111.10",c10},
            new Object[]{15,"100.00",null,List.of(newer,older),TODAY,"90.00",older},
            new Object[]{16,"100.00",null,List.of(highId,p10),TODAY,"90.00",p10},
            new Object[]{17,"0.40",null,List.of(percent(DiscountTargetType.PRODUCT,"1")),TODAY,"0.40",null});
    }
    @ParameterizedTest(name="accepted worked example {0}") @MethodSource("workedExamples")
    void greatestSavingWithoutStacking(int row, String selling, String mrp, List<Discount> candidates,
            LocalDate today, String expected, Discount winner) {
        if (row == 13) {
            assertThatThrownBy(() -> PriceCalculator.price(PRODUCT,CATEGORY,Money.parse(selling),Money.parse(mrp),candidates,today)).isInstanceOf(IllegalArgumentException.class);
            return;
        }
        var result = PriceCalculator.price(PRODUCT,CATEGORY,Money.parse(selling),mrp == null ? null : Money.parse(mrp),candidates,today);
        assertThat(result.price().toString()).isEqualTo(expected);
        assertThat(result.saving().scale()).isEqualTo(2);
        assertThat(result.discountId()).isEqualTo(winner == null ? null : winner.id());
        if (mrp != null) assertThat(result.price().compareTo(Money.parse(mrp))).isLessThanOrEqualTo(0);
    }
    @Test void unrelatedTargetsAreIgnoredAndCategoryMovesFollowCurrentMembership() {
        var category = percent(DiscountTargetType.CATEGORY,"10");
        var unrelated = new Discount(UUID.randomUUID(),DiscountTargetType.PRODUCT,UUID.randomUUID(),DiscountKind.PERCENTAGE,new BigDecimal("99"),TODAY,null,null,Instant.EPOCH);
        assertThat(PriceCalculator.price(PRODUCT,CATEGORY,Money.parse("100"),null,List.of(category,unrelated),TODAY).price().toString()).isEqualTo("90.00");
        assertThat(PriceCalculator.price(PRODUCT,UUID.randomUUID(),Money.parse("100"),null,List.of(category,unrelated),TODAY).price().toString()).isEqualTo("100.00");
        assertThat(PriceCalculator.price(PRODUCT,CATEGORY,Money.parse("100"),null,List.of(),TODAY).discountId()).isNull();
        assertThatThrownBy(() -> PriceCalculator.price(PRODUCT,CATEGORY,null,null,List.of(),TODAY)).isInstanceOf(NullPointerException.class);
    }
    @Test void aWinnerInTheMiddleIsNotOverwrittenByALesserCandidate() {
        var winner = percent(DiscountTargetType.CATEGORY,"15");
        assertThat(PriceCalculator.price(PRODUCT,CATEGORY,Money.parse("100"),null,List.of(percent(DiscountTargetType.PRODUCT,"10"),winner,percent(DiscountTargetType.PRODUCT,"5")),TODAY).price().toString()).isEqualTo("85.00");
    }
}
