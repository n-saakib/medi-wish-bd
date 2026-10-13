package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class EffectivePriceTest {
    @Test
    void downstreamSnapshotsContainOnlyImmutableValueComponents() {
        assertThat(EffectivePrice.class.isRecord()).isTrue();
        Map<String, Class<?>> declaredTypes = Arrays.stream(EffectivePrice.class.getRecordComponents())
                .collect(Collectors.toMap(component -> component.getName(), component -> component.getType()));
        Map<String, Class<?>> expectedTypes = Map.of(
                "productId", UUID.class, "sellingPrice", Money.class, "mrp", Money.class, "price", Money.class,
                "saving", BigDecimal.class, "discountId", UUID.class, "discountTarget", DiscountTargetType.class,
                "discountKind", DiscountKind.class, "discountValue", BigDecimal.class, "pricedOn", LocalDate.class);
        assertThat(declaredTypes).containsExactlyInAnyOrderEntriesOf(expectedTypes);
        Set<Class<?>> allowed = Set.of(UUID.class, Money.class, BigDecimal.class, LocalDate.class,
                DiscountTargetType.class, DiscountKind.class);
        assertThat(Arrays.stream(EffectivePrice.class.getRecordComponents()).map(component -> component.getType()))
                .hasSize(10).allSatisfy(type -> assertThat(allowed).contains(type));
    }
}
