package bd.mediwish.catalog;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Read-only public catalog projections with bounded Product, image, and pricing queries. */
@Service
class PublicCatalogService {
    static final int PAGE_SIZE = 24;

    private final CategoryRepository categories;
    private final ProductRepository products;
    private final ProductImageRepository images;
    private final CurrentPrices currentPrices;

    PublicCatalogService(CategoryRepository categories, ProductRepository products, ProductImageRepository images,
            CurrentPrices currentPrices) {
        this.categories = categories;
        this.products = products;
        this.images = images;
        this.currentPrices = currentPrices;
    }

    @Transactional(readOnly = true)
    PublicCategoryList categories() {
        return new PublicCategoryList(categories.findListable().stream()
                .map(category -> new PublicCategory(category.id(), category.name())).toList());
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    PublicCategoryPage categoryPage(UUID categoryId, int page) {
        Category category = categories.findById(categoryId).filter(Category::active)
                .orElseThrow(CatalogNotFoundException::new);
        long total = products.countListed(categoryId);
        long lastPage = total == 0 ? 0 : (total - 1) / PAGE_SIZE;
        if (page < 0 || page > lastPage) throw new CatalogNotFoundException();

        List<Product> listed = products.findListed(categoryId, PageRequest.of(page, PAGE_SIZE));
        if (listed.isEmpty()) {
            return new PublicCategoryPage(new PublicCategory(category.id(), category.name()), List.of(), page,
                    PAGE_SIZE, total);
        }

        List<UUID> ids = listed.stream().map(Product::id).toList();
        Map<UUID, ProductImage> mainImages = new HashMap<>();
        images.findMainImages(ids).forEach(image -> mainImages.put(image.productId(), image));
        Map<UUID, EffectivePrice> prices = currentPrices.forProducts(listed);
        List<PublicProductCard> cards = listed.stream()
                .map(product -> card(product, mainImages.get(product.id()), prices.get(product.id())))
                .filter(java.util.Objects::nonNull)
                .toList();
        return new PublicCategoryPage(new PublicCategory(category.id(), category.name()), cards, page, PAGE_SIZE,
                total);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    PublicProductDetails product(UUID productId) {
        Product product = products.findListedById(productId).orElseThrow(CatalogNotFoundException::new);
        EffectivePrice price = currentPrices.forProducts(List.of(product)).get(product.id());
        if (price == null) throw new CatalogNotFoundException();

        ProductRules.CatalogFields fields = product.fields();
        PublicCategory category = product.category().active()
                ? new PublicCategory(product.category().id(), product.category().name()) : null;
        List<PublicCatalogImage> productImages = images.findByProductIdOrderByDisplayOrder(product.id()).stream()
                .map(PublicCatalogService::image).toList();
        boolean medicine = product.kind() == ProductKind.MEDICINE;
        return new PublicProductDetails(product.id(), fields.name(), fields.brandName(),
                medicine ? fields.genericName() : null, medicine ? fields.dosageForm() : null,
                fields.manufacturer(), fields.saleUnit(), fields.description(), product.requireValidation(), category,
                productImages, PublicCatalogViews.price(price));
    }

    private static PublicProductCard card(Product product, ProductImage image, EffectivePrice price) {
        if (price == null) return null;
        ProductRules.CatalogFields fields = product.fields();
        return new PublicProductCard(product.id(), fields.name(), product.kind() == ProductKind.MEDICINE
                ? fields.genericName() : null, fields.saleUnit(), image == null ? null : image(image),
                PublicCatalogViews.price(price));
    }

    private static PublicCatalogImage image(ProductImage image) {
        return new PublicCatalogImage(ProductImageRules.publicPath(image.id(), image.contentType()), image.altText(),
                image.width(), image.height());
    }
}
