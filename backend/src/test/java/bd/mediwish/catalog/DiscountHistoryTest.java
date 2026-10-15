package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

class DiscountHistoryTest {
    private final LocalDate today = LocalDate.of(2026, 10, 9);
    private Discount discount(LocalDate start, LocalDate end) {
        return new Discount(UUID.randomUUID(), DiscountTargetType.CATEGORY, UUID.randomUUID(),
                DiscountKind.PERCENTAGE, new BigDecimal("10.00"), start, end, null, Instant.EPOCH);
    }
    @Test void runningDiscountStartsAtDhakaMidnightWithNoActor() {
        var entries = DiscountHistory.entries(List.of(discount(today, null)), Map.of(), today);
        assertThat(entries).hasSize(1);
        assertThat(entries.getFirst().occurredAt()).isEqualTo(Instant.parse("2026-10-08T18:00:00Z"));
        assertThat(entries.getFirst().actorUsername()).isNull();
        assertThat(entries.getFirst().changeType()).isEqualTo(ProductChangeType.DISCOUNT_STARTED);
        assertThat(entries.getFirst().discount().value()).isEqualTo("10");
    }
    @Test void manualEndUsesItsPersistedInstantAndActor() {
        var discount = discount(today, null);
        var actor = UUID.randomUUID();
        var end = Instant.parse("2026-10-09T01:02:03Z");
        discount.end(actor, end);
        var entries = DiscountHistory.entries(List.of(discount), Map.of(actor, "synthetic.admin"), today);
        assertThat(entries).hasSize(2);
        assertThat(entries.get(1).occurredAt()).isEqualTo(end);
        assertThat(entries.get(1).actorUsername()).isEqualTo("synthetic.admin");
        assertThat(entries.get(1).changeType()).isEqualTo(ProductChangeType.DISCOUNT_ENDED);
    }
    @Test void scheduledEndOccursAfterItsInclusiveLastDay() {
        var entries = DiscountHistory.entries(List.of(discount(today.minusDays(3), today.minusDays(1))), Map.of(), today);
        assertThat(entries).hasSize(2);
        assertThat(entries.get(1).occurredAt()).isEqualTo(Instant.parse("2026-10-08T18:00:00Z"));
        assertThat(entries.get(1).actorUsername()).isNull();
    }
    @Test void endedBeforeStartingNeverAppearsInHistory() {
        var discount = discount(today, null);
        discount.end(null, Instant.parse("2026-10-08T17:59:59Z"));
        assertThat(DiscountHistory.entries(List.of(discount), Map.of(), today)).isEmpty();
        assertThat(DiscountHistory.entries(List.of(discount(today.plusDays(1), null)), Map.of(), today)).isEmpty();
    }
}
