package bd.mediwish.catalog;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

record DiscountView(UUID id, DiscountTargetType targetType, UUID targetId, String targetName, Long productCount,
        DiscountKind kind, String value, LocalDate startsOn, LocalDate endsOn, DiscountStatus status, long version,
        Instant updatedAt, String updatedByUsername) {
}

record DiscountCounts(long active, long scheduled) {
}

record DiscountPage(List<DiscountView> items, int page, int size, long totalItems, DiscountCounts counts) {
}

record AppliedDiscount(UUID id, DiscountTargetType targetType, String targetName, DiscountKind kind, String value,
        String saving) {
}
