package bd.mediwish.catalog;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import java.util.UUID;

/** Minimal anonymous current-price read for active, priced Products. */
@RestController
class PublicPriceController {
    private final CurrentPrices prices;

    PublicPriceController(CurrentPrices prices) { this.prices = prices; }

    @GetMapping("/api/products/{id}/price")
    PublicPrice price(@PathVariable String id) {
        UUID productId;
        try { productId = CatalogRequests.uuid(id); }
        catch (InvalidCatalogException invalid) { throw new CatalogNotFoundException(); }
        var price = prices.forActiveProduct(productId).orElseThrow(CatalogNotFoundException::new);
        var discount = price.discountId() == null ? null : new PublicDiscount(price.discountTarget(),
                price.discountKind(), price.discountKind() == DiscountKind.PERCENTAGE
                ? price.discountValue().stripTrailingZeros().toPlainString() : price.discountValue().toPlainString());
        return new PublicPrice(price.productId(), price.sellingPrice().toString(),
                price.mrp() == null ? null : price.mrp().toString(), price.price().toString(), price.saving().toPlainString(), discount);
    }

    record PublicPrice(UUID productId, String sellingPrice, String mrp, String price, String saving, PublicDiscount discount) {}
    record PublicDiscount(DiscountTargetType targetType, DiscountKind kind, String value) {}
}
