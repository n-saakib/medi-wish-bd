package bd.mediwish.catalog;

import bd.mediwish.user.UserRepository;
import org.springframework.stereotype.Service;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Service
public class DiscountHistory {

    private final DiscountRepository discounts;

    private final UserRepository users;

    private final DiscountCalendar calendar;

    public DiscountHistory(DiscountRepository discounts, UserRepository users, DiscountCalendar calendar) {
        this.discounts = discounts;
        this.users = users;
        this.calendar = calendar;
    }

    List<ProductHistory> forProduct(UUID productId, UUID categoryId) {
        return forProduct(productId, categoryId, calendar.today());
    }

    List<ProductHistory> forProduct(UUID productId, UUID categoryId, LocalDate today) {
        var found = discounts.findHistory(productId, categoryId, today);
        var ids = found.stream()
            .filter(d -> d.endedAt() != null)
            .map(Discount::updatedBy)
            .filter(Objects::nonNull)
            .distinct()
            .toList();
        Map<UUID, String> usernames = new HashMap<>();
        if (!ids.isEmpty())
            users.findUsernamesById(ids).forEach(u -> usernames.put(u.getUserId(), u.getUsername()));
        return entries(found, usernames, today);
    }

    static List<ProductHistory> entries(List<Discount> discounts, Map<UUID, String> usernames, LocalDate today) {
        List<ProductHistory> result = new ArrayList<>();
        for (Discount d : discounts) {
            if (d.startsOn().isAfter(today))
                continue;
            var start = d.startsOn().atStartOfDay(DiscountCalendar.ZONE).toInstant();
            if (d.endedAt() != null && d.endedAt().isBefore(start))
                continue;
            var detail = new HistoryDiscount(d.targetType(), d.kind(), renderValue(d));
            result.add(new ProductHistory(start, null, ProductChangeType.DISCOUNT_STARTED, null, null, null, null, null,
                    null, detail));
            if (d.endedAt() != null)
                result.add(new ProductHistory(d.endedAt(), usernames.get(d.updatedBy()),
                        ProductChangeType.DISCOUNT_ENDED, null, null, null, null, null, null, detail));
            else if (d.endsOn() != null && d.endsOn().isBefore(today))
                result.add(new ProductHistory(d.endsOn().plusDays(1).atStartOfDay(DiscountCalendar.ZONE).toInstant(),
                        null, ProductChangeType.DISCOUNT_ENDED, null, null, null, null, null, null, detail));
        }
        return result;
    }

    static String renderValue(Discount d) {
        return d.kind() == DiscountKind.PERCENTAGE ? d.value().stripTrailingZeros().toPlainString()
                : Money.parse(d.value().toPlainString()).toString();
    }

}
