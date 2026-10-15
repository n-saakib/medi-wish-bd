package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.user.UserRepository;
import bd.mediwish.web.StaleUpdateException;
import org.slf4j.MDC;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Service
public class DiscountService {

    private final DiscountRepository discounts;

    private final DiscountChangeRepository changes;

    private final ProductRepository products;

    private final CategoryRepository categories;

    private final UserRepository users;

    private final DiscountCalendar calendar;

    private final Clock clock;

    DiscountService(DiscountRepository discounts, DiscountChangeRepository changes, ProductRepository products,
            CategoryRepository categories, UserRepository users, DiscountCalendar calendar, Clock clock) {
        this.discounts = discounts;
        this.changes = changes;
        this.products = products;
        this.categories = categories;
        this.users = users;
        this.calendar = calendar;
        this.clock = clock;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    DiscountPage list(DiscountStatus status, int page, int size, CurrentUser current) {
        CatalogAuthorization.require(current, CatalogArea.PRICING);
        CategoryService.page(page, size);
        if (status == null)
            throw new InvalidCatalogException("status");
        LocalDate today = calendar.today();
        var request = PageRequest.of(page, size);
        var found = switch (status) {
            case ACTIVE -> discounts.findActive(today, request);
            case SCHEDULED -> discounts.findScheduled(today, request);
            case ENDED -> discounts.findEnded(today, request);
        };
        var counts = discounts.countActiveAndScheduled(today);
        return new DiscountPage(views(found.getContent(), today), page, size, found.getTotalElements(),
                new DiscountCounts(counts.getActive() == null ? 0 : counts.getActive(),
                        counts.getScheduled() == null ? 0 : counts.getScheduled()));
    }

    @Transactional
    CatalogCreation<DiscountView> create(DiscountRequests.DiscountCreate input, CurrentUser current) {
        CatalogAuthorization.require(current, CatalogArea.PRICING);
        LocalDate today = calendar.today();
        var existing = discounts.findById(input.id());
        if (existing.isPresent()) {
            requireSameCreate(existing.get(), input);
            return new CatalogCreation<>(view(existing.get(), today), false);
        }
        DiscountRules.create(input.kind(), input.value(), input.startsOn(), input.endsOn(), today);
        if (input.targetType() == DiscountTargetType.CATEGORY)
            categories.findById(input.targetId())
                .filter(Category::active)
                .orElseThrow(() -> new InvalidCatalogException("targetId"));
        else
            checkPrice(input.targetId(), input.kind(), input.value(), true);
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        int inserted = discounts.insertIfAbsent(input.id(), input.targetType().name(),
                input.targetType() == DiscountTargetType.PRODUCT ? input.targetId() : null,
                input.targetType() == DiscountTargetType.CATEGORY ? input.targetId() : null, input.kind().name(),
                input.kind() == DiscountKind.PERCENTAGE ? input.value() : null,
                input.kind() == DiscountKind.FLAT ? input.value() : null, input.startsOn(), input.endsOn(),
                current.userId(), now);
        var stored = discounts.findById(input.id()).orElseThrow(CatalogNotFoundException::new);
        requireSameCreate(stored, input);
        if (inserted == 1) {
            changes.save(new DiscountChange(stored, now, current.userId(), DiscountChangeType.CREATED,
                    MDC.get("requestId")));
            changes.flush();
        }
        return new CatalogCreation<>(view(stored, today), inserted == 1);
    }

    @Transactional
    DiscountView update(UUID id, DiscountRequests.DiscountUpdate input, CurrentUser current) {
        CatalogAuthorization.require(current, CatalogArea.PRICING);
        LocalDate today = calendar.today();
        var stored = discounts.findByIdForUpdate(id).orElseThrow(CatalogNotFoundException::new);
        if (DiscountRules.same(stored, input.kind(), input.value(), input.startsOn(), input.endsOn()))
            return view(stored, today);
        if (stored.version() != input.version())
            throw new StaleUpdateException();
        DiscountRules.update(stored, input.kind(), input.value(), input.startsOn(), input.endsOn(), today);
        if (stored.targetType() == DiscountTargetType.PRODUCT)
            checkPrice(stored.targetId(), input.kind(), input.value(), false);
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        stored.update(input.kind(), input.value(), input.startsOn(), input.endsOn(), current.userId(), now);
        changes
            .save(new DiscountChange(stored, now, current.userId(), DiscountChangeType.UPDATED, MDC.get("requestId")));
        discounts.flush();
        changes.flush();
        return view(stored, today);
    }

    @Transactional
    DiscountView end(UUID id, long version, CurrentUser current) {
        CatalogAuthorization.require(current, CatalogArea.PRICING);
        LocalDate today = calendar.today();
        var stored = discounts.findByIdForUpdate(id).orElseThrow(CatalogNotFoundException::new);
        if (stored.status(today) == DiscountStatus.ENDED)
            return view(stored, today);
        if (stored.version() != version)
            throw new StaleUpdateException();
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        stored.end(current.userId(), now);
        changes.save(new DiscountChange(stored, now, current.userId(), DiscountChangeType.ENDED, MDC.get("requestId")));
        discounts.flush();
        changes.flush();
        return view(stored, today);
    }

    private void checkPrice(UUID id, DiscountKind kind, java.math.BigDecimal value, boolean creating) {
        var product = products.findById(id)
            .orElseThrow(() -> creating ? new InvalidCatalogException("targetId") : new CatalogNotFoundException());
        if (DiscountRules.exceedsPrice(kind, value, product.sellingPrice()))
            throw new DiscountExceedsPriceException();
    }

    private static void requireSameCreate(Discount stored, DiscountRequests.DiscountCreate input) {
        if (stored.targetType() != input.targetType() || !stored.targetId().equals(input.targetId())
                || !DiscountRules.same(stored, input.kind(), input.value(), input.startsOn(), input.endsOn()))
            throw new IdConflictException();
    }

    private DiscountView view(Discount stored, LocalDate today) {
        return views(List.of(stored), today).getFirst();
    }

    private List<DiscountView> views(List<Discount> found, LocalDate today) {
        if (found.isEmpty())
            return List.of();
        var productIds = found.stream().map(Discount::productId).filter(Objects::nonNull).distinct().toList();
        var categoryIds = found.stream().map(Discount::categoryId).filter(Objects::nonNull).distinct().toList();
        var userIds = found.stream().map(Discount::updatedBy).filter(Objects::nonNull).distinct().toList();
        Map<UUID, String> productNames = new HashMap<>();
        if (!productIds.isEmpty())
            products.findNamesById(productIds).forEach(p -> productNames.put(p.getProductId(), p.getName()));
        Map<UUID, String> categoryNames = new HashMap<>();
        if (!categoryIds.isEmpty())
            categories.findAllById(categoryIds).forEach(c -> categoryNames.put(c.id(), c.name()));
        Map<UUID, Long> counts = new HashMap<>();
        if (!categoryIds.isEmpty())
            categories.countProducts(categoryIds).forEach(c -> counts.put(c.getCategoryId(), c.getProductCount()));
        Map<UUID, String> usernames = new HashMap<>();
        if (!userIds.isEmpty())
            users.findUsernamesById(userIds).forEach(u -> usernames.put(u.getUserId(), u.getUsername()));
        return found.stream()
            .map(d -> new DiscountView(d.id(), d.targetType(), d.targetId(),
                    (d.targetType() == DiscountTargetType.PRODUCT ? productNames : categoryNames).get(d.targetId()),
                    d.targetType() == DiscountTargetType.PRODUCT ? null : counts.getOrDefault(d.targetId(), 0L),
                    d.kind(), DiscountHistory.renderValue(d), d.startsOn(), d.endsOn(), d.status(today), d.version(),
                    d.updatedAt(), usernames.get(d.updatedBy())))
            .toList();
    }

}
