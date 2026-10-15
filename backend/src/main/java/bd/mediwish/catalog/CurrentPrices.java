package bd.mediwish.catalog;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDate;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class CurrentPrices {

    private final ProductRepository products;

    private final DiscountRepository discounts;

    private final DiscountCalendar calendar;

    public CurrentPrices(ProductRepository products, DiscountRepository discounts, DiscountCalendar calendar) {
        this.products = products;
        this.discounts = discounts;
        this.calendar = calendar;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Optional<EffectivePrice> forProduct(UUID productId) {
        LocalDate today = calendar.today();
        return products.findById(productId)
            .flatMap(p -> Optional.ofNullable(forProducts(List.of(p), today).get(p.id())));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Optional<EffectivePrice> forActiveProduct(UUID productId) {
        LocalDate today = calendar.today();
        return products.findById(productId)
            .filter(Product::active)
            .flatMap(p -> Optional.ofNullable(forProducts(List.of(p), today).get(p.id())));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<UUID, EffectivePrice> forProducts(Collection<Product> products) {
        return forProducts(products, calendar.today());
    }

    Map<UUID, EffectivePrice> forProducts(Collection<Product> products, LocalDate today) {
        List<Product> priced = products.stream().filter(p -> p.sellingPrice() != null).toList();
        if (priced.isEmpty())
            return Map.of();
        var candidates = discounts.findCandidates(today, priced.stream().map(Product::id).toList(),
                priced.stream().map(p -> p.category().id()).distinct().toList());
        Map<UUID, EffectivePrice> result = new LinkedHashMap<>();
        for (Product p : priced)
            result.put(p.id(),
                    PriceCalculator.price(p.id(), p.category().id(), p.sellingPrice(), p.mrp(), candidates, today));
        return result;
    }

}
