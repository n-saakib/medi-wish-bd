package bd.mediwish.catalog;

import java.util.List;
import java.util.UUID;

/** Minimal immutable projections returned by the public catalog read model. */
final class PublicCatalogViews {
    private PublicCatalogViews() {}

    static PublicPriceView price(EffectivePrice current) {
        PublicDiscount discount = current.discountId() == null ? null : new PublicDiscount(current.discountTarget(),
                current.discountKind(), current.discountKind() == DiscountKind.PERCENTAGE
                ? current.discountValue().stripTrailingZeros().toPlainString() : current.discountValue().toPlainString());
        return new PublicPriceView(current.sellingPrice().toString(),
                current.mrp() == null ? null : current.mrp().toString(), current.price().toString(),
                current.saving().toPlainString(), discount);
    }
}

record PublicCategory(UUID id, String name) {}

record PublicCategoryList(List<PublicCategory> categories) {
    PublicCategoryList { categories = List.copyOf(categories); }
}

record PublicCatalogImage(String url, String altText, int width, int height) {}

record PublicPriceView(String sellingPrice, String mrp, String price, String saving, PublicDiscount discount) {}

record PublicDiscount(DiscountTargetType targetType, DiscountKind kind, String value) {}

record PublicProductCard(UUID id, String name, String genericName, String saleUnit, PublicCatalogImage image,
        PublicPriceView price) {}

record PublicCategoryPage(PublicCategory category, List<PublicProductCard> items, int page, int size, long totalItems) {
    PublicCategoryPage { items = List.copyOf(items); }
}

record PublicProductDetails(UUID id, String name, String brandName, String genericName, String dosageForm,
        String manufacturer, String saleUnit, String description, boolean requireValidation, PublicCategory category,
        List<PublicCatalogImage> images, PublicPriceView price) {
    PublicProductDetails { images = List.copyOf(images); }
}
