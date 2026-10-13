package bd.mediwish.catalog;

import bd.mediwish.web.StaleUpdateException;
import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.user.UserRepository;
import org.slf4j.MDC;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@Service
public class ProductService {
    private final ProductRepository products;
    private final CategoryRepository categories;
    private final ProductChangeRepository changes;
    private final UserRepository users;
    private final Clock clock;
    private final CurrentPrices prices;
    private final DiscountHistory discountHistory;
    private final DiscountCalendar calendar;

    ProductService(ProductRepository products, CategoryRepository categories,
                   ProductChangeRepository changes, UserRepository users, Clock clock,
                   CurrentPrices prices, DiscountHistory discountHistory, DiscountCalendar calendar) {
        this.products = products;
        this.categories = categories;
        this.changes = changes;
        this.users = users;
        this.clock = clock;
        this.prices = prices;
        this.discountHistory = discountHistory;
        this.calendar = calendar;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    CatalogPage<ProductSummary> list(String query, UUID categoryId, ProductStatus status,
                                     boolean reviewRequired, int page, int size) {
        CategoryService.page(page, size);
        if (query != null && query.length() > 100) throw new InvalidCatalogException("q");
        String pattern = query == null || query.isBlank() ? null : "%" + query.toLowerCase(java.util.Locale.ROOT)
                .replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
        var found = products.search(pattern, categoryId, status == null ? null : status.name(),
                reviewRequired ? true : null, PageRequest.of(page, size));
        var currentPrices = prices.forProducts(found.getContent());
        return new CatalogPage<>(found.getContent().stream().map(p -> summary(p, currentPrices.get(p.id()))).toList(),
                page, size, found.getTotalElements());
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    ProductView get(UUID id) {
        return view(products.findById(id).orElseThrow(CatalogNotFoundException::new));
    }

    @Transactional
    CatalogCreation<ProductView> create(UUID id, ProductKind kind, ProductRules.CatalogFields submitted,
                                        CurrentUser current) {
        if (id == null) throw new InvalidCatalogException("id");
        var fields = ProductRules.validateCatalog(kind, submitted);
        if (fields.active()) throw new InvalidCatalogException("active");
        CatalogAuthorization.require(current, CatalogArea.CATALOG);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        int inserted = products.insertIfAbsent(id, kind.name(), fields.name(), fields.brandName(),
                fields.genericName(), fields.manufacturer(), fields.dosageForm(), fields.saleUnit(),
                fields.description(), fields.categoryId(), fields.requireValidation(), current.userId(), now);
        Product stored = products.findById(id).orElseThrow(() -> new InvalidCatalogException("categoryId"));
        if (inserted == 0 && !ProductRules.sameCreate(stored.kind(), stored.fields(), kind, fields)) {
            throw new IdConflictException();
        }
        if (inserted == 1) {
            record(stored.id(), now, current, ProductChangeType.CREATED,
                    null, null, null, null, null, fields.requireValidation());
            changes.flush();
        }
        return new CatalogCreation<>(view(stored), inserted == 1);
    }

    @Transactional
    ProductView updateCatalog(UUID id, ProductRules.CatalogFields submitted, Long version, CurrentUser current) {
        if (id == null || submitted == null || version == null || version < 0) {
            throw new InvalidCatalogException("catalog");
        }
        Product stored = products.findByIdForUpdate(id).orElseThrow(CatalogNotFoundException::new);
        CatalogAuthorization.require(current, CatalogArea.CATALOG);
        var before = stored.fields();
        var normalized = ProductRules.normalizeCatalog(submitted);
        var diff = ProductRules.diff(before, normalized, stored.sellingPrice(), stored.sellingPrice(),
                stored.mrp(), stored.mrp());
        if (diff.isEmpty()) return view(stored);
        if (stored.version() != version) throw new StaleUpdateException();
        var fields = ProductRules.validateCatalog(stored.kind(), submitted);
        Category category = stored.category();
        if (!Objects.equals(before.categoryId(), fields.categoryId())) {
            category = categories.findById(fields.categoryId())
                    .filter(Category::active).orElseThrow(() -> new InvalidCatalogException("categoryId"));
        }
        ProductRules.requirePurchasable(fields.active(), stored.sellingPrice());
        Money price = stored.sellingPrice();
        Money mrp = stored.mrp();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        stored.updateCatalog(fields, category, current.userId(), now);
        for (var type : diff) {
            record(id, now, current, type, price, price, mrp, mrp,
                    before.requireValidation(), fields.requireValidation());
        }
        products.flush();
        changes.flush();
        return view(stored);
    }

    @Transactional
    ProductView updatePricing(UUID id, Money price, Money mrp, Long version, CurrentUser current) {
        if (id == null || version == null || version < 0) throw new InvalidCatalogException("pricing");
        Product stored = products.findByIdForUpdate(id).orElseThrow(CatalogNotFoundException::new);
        CatalogAuthorization.require(current, CatalogArea.PRICING);
        var before = stored.fields();
        var diff = ProductRules.diff(before, before, stored.sellingPrice(), price, stored.mrp(), mrp);
        if (diff.isEmpty()) return view(stored);
        if (stored.version() != version) throw new StaleUpdateException();
        ProductRules.validatePricing(price, mrp);
        Money oldPrice = stored.sellingPrice();
        Money oldMrp = stored.mrp();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        stored.updatePricing(price, mrp, current.userId(), now);
        record(id, now, current, ProductChangeType.PRICE_CHANGED, oldPrice, price, oldMrp, mrp,
                before.requireValidation(), before.requireValidation());
        products.flush();
        changes.flush();
        return view(stored);
    }

    private void record(UUID productId, Instant now, CurrentUser current, ProductChangeType type,
                        Money oldPrice, Money newPrice, Money oldMrp, Money newMrp,
                        Boolean oldFlag, Boolean newFlag) {
        changes.save(new ProductChange(productId, now, users.getReferenceById(current.userId()), type,
                oldPrice, newPrice, oldMrp, newMrp, oldFlag, newFlag, MDC.get("requestId")));
    }

    private ProductView view(Product product) {
        var fields = product.fields();
        var today = calendar.today();
        var price = prices.forProducts(List.of(product), today).get(product.id());
        String editor = product.updatedBy() == null ? null : users.findById(product.updatedBy())
                .map(user -> user.username()).orElse(null);
        List<ProductHistory> history = changes.findLatest(product.id(), PageRequest.of(0, 20)).stream()
                .map(change -> new ProductHistory(change.getOccurredAt(), change.getActorUsername(),
                        change.getChangeType(), decimal(change.getOldSellingPrice()),
                        decimal(change.getNewSellingPrice()), decimal(change.getOldMrp()),
                        decimal(change.getNewMrp()), change.getOldRequireValidation(),
                        change.getNewRequireValidation(), null)).toList();
        history = java.util.stream.Stream.concat(history.stream(),
                discountHistory.forProduct(product.id(), fields.categoryId(), today).stream())
                .sorted(java.util.Comparator.comparing(ProductHistory::occurredAt).reversed()
                        .thenComparing(entry -> entry.discount() == null ? 0 : 1))
                .limit(20).toList();
        return new ProductView(product.id(), product.kind(), fields.name(), fields.brandName(),
                fields.genericName(), fields.dosageForm(), fields.manufacturer(), fields.categoryId(),
                product.category().name(), fields.saleUnit(), decimal(product.sellingPrice()),
                decimal(product.mrp()), product.active(), product.requireValidation(), product.status(),
                fields.description(), product.version(), product.updatedAt(), editor, history,
                price == null ? null : price.price().toString(), applied(price, product));
    }

    private static ProductSummary summary(Product product, EffectivePrice price) {
        var fields = product.fields();
        return new ProductSummary(product.id(), product.kind(), fields.name(), fields.brandName(),
                fields.genericName(), fields.dosageForm(), fields.manufacturer(), fields.categoryId(),
                product.category().name(), fields.saleUnit(), decimal(product.sellingPrice()),
                decimal(product.mrp()), product.active(), product.requireValidation(), product.status(),
                price == null ? null : price.price().toString(), applied(price, product));
    }

    private static AppliedDiscount applied(EffectivePrice price, Product product) {
        if (price == null || price.discountId() == null) return null;
        String name = price.discountTarget() == DiscountTargetType.PRODUCT
                ? product.fields().name() : product.category().name();
        String value = price.discountKind() == DiscountKind.PERCENTAGE
                ? price.discountValue().stripTrailingZeros().toPlainString()
                : Money.parse(price.discountValue().toPlainString()).toString();
        return new AppliedDiscount(price.discountId(), price.discountTarget(), name,
                price.discountKind(), value, price.saving().toPlainString());
    }

    private static String decimal(Money amount) { return amount == null ? null : amount.toString(); }
    private static String decimal(java.math.BigDecimal amount) {
        return amount == null ? null : amount.toPlainString();
    }
}
