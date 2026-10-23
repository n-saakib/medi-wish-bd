package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class PublicCatalogServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-19T00:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 19);
    private static final int PAGE_SIZE = 24;

    private final CategoryRepository categories = mock(CategoryRepository.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final ProductImageRepository images = mock(ProductImageRepository.class);
    private final CurrentPrices prices = mock(CurrentPrices.class);
    private final PublicCatalogService service = new PublicCatalogService(categories, products, images, prices);

    @Test
    void categoriesPreservesRepositoryOrderAndMapsOnlyPublicFields() {
        var first = new Category(UUID.randomUUID(), "Alpha", null, NOW);
        var second = new Category(UUID.randomUUID(), "beta", null, NOW);
        when(categories.findListable()).thenReturn(List.of(first, second));

        assertThat(service.categories().categories()).containsExactly(
                new PublicCategory(first.id(), "Alpha"),
                new PublicCategory(second.id(), "beta"));
        verify(categories).findListable();
        verifyNoInteractions(products, images, prices);
    }

    @Test
    void unknownAndInactiveCategoriesFailBeforeProductQueries() {
        UUID id = UUID.randomUUID();
        when(categories.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.categoryPage(id, 0)).isInstanceOf(CatalogNotFoundException.class);
        verifyNoInteractions(products, images, prices);

        var inactive = mock(Category.class);
        when(inactive.active()).thenReturn(false);
        when(categories.findById(id)).thenReturn(Optional.of(inactive));

        assertThatThrownBy(() -> service.categoryPage(id, 0)).isInstanceOf(CatalogNotFoundException.class);
        verifyNoInteractions(products, images, prices);
    }

    @Test
    void categoryPagesUseFixed24ItemOffsetsAndRejectPastTheLastPageBeforeFetching() {
        var category = category("Pain");
        when(categories.findById(category.id())).thenReturn(Optional.of(category));
        when(products.countListed(category.id())).thenReturn(25L);
        var firstPage = products(24, category, ProductKind.MEDICINE);
        var secondPage = products(1, category, ProductKind.MEDICINE);
        var allProducts = new ArrayList<>(firstPage);
        allProducts.addAll(secondPage);
        var allPrices = pricesFor(allProducts);
        when(products.findListed(category.id(), PageRequest.of(0, PAGE_SIZE))).thenReturn(firstPage);
        when(products.findListed(category.id(), PageRequest.of(1, PAGE_SIZE))).thenReturn(secondPage);
        when(images.findMainImages(org.mockito.ArgumentMatchers.anyCollection())).thenReturn(List.of());
        when(prices.forProducts(org.mockito.ArgumentMatchers.anyCollection())).thenReturn(allPrices);

        var page0 = service.categoryPage(category.id(), 0);
        var page1 = service.categoryPage(category.id(), 1);

        assertThat(page0.items()).hasSize(PAGE_SIZE);
        assertThat(page0.page()).isZero();
        assertThat(page0.size()).isEqualTo(PAGE_SIZE);
        assertThat(page0.totalItems()).isEqualTo(25);
        assertThat(page1.items()).hasSize(1);
        assertThat(page1.page()).isEqualTo(1);
        assertThat(page1.totalItems()).isEqualTo(25);
        assertThatThrownBy(() -> service.categoryPage(category.id(), 2)).isInstanceOf(CatalogNotFoundException.class);
        verify(products).findListed(category.id(), PageRequest.of(0, PAGE_SIZE));
        verify(products).findListed(category.id(), PageRequest.of(1, PAGE_SIZE));
        verify(products, never()).findListed(category.id(), PageRequest.of(2, PAGE_SIZE));
    }

    @Test
    void emptyCategoryPageAvoidsImageAndPriceQueriesAndRejectsPageOne() {
        var category = category("Empty");
        when(categories.findById(category.id())).thenReturn(Optional.of(category));
        when(products.countListed(category.id())).thenReturn(0L);
        when(products.findListed(category.id(), PageRequest.of(0, PAGE_SIZE))).thenReturn(List.of());

        var result = service.categoryPage(category.id(), 0);

        assertThat(result.items()).isEmpty();
        assertThat(result.totalItems()).isZero();
        assertThatThrownBy(() -> service.categoryPage(category.id(), 1)).isInstanceOf(CatalogNotFoundException.class);
        verifyNoInteractions(images, prices);
    }

    @Test
    void pageBatchesImagesAndPricesForAllProductsAndSkipsMissingPriceRows() {
        var category = category("Batch");
        when(categories.findById(category.id())).thenReturn(Optional.of(category));
        when(products.countListed(category.id())).thenReturn(24L);
        var page = products(PAGE_SIZE, category, ProductKind.MEDICINE);
        when(products.findListed(category.id(), PageRequest.of(0, PAGE_SIZE))).thenReturn(page);
        UUID mainImageProductId = page.getFirst().id();
        UUID imageId = UUID.randomUUID();
        var mainImage = mock(ProductImage.class);
        when(mainImage.id()).thenReturn(imageId);
        when(mainImage.productId()).thenReturn(mainImageProductId);
        when(mainImage.contentType()).thenReturn("image/jpeg");
        when(mainImage.altText()).thenReturn("Front");
        when(mainImage.width()).thenReturn(800);
        when(mainImage.height()).thenReturn(600);
        when(images.findMainImages(page.stream().map(Product::id).toList())).thenReturn(List.of(mainImage));
        var byId = new HashMap<>(pricesFor(page));
        byId.remove(page.getLast().id());
        when(prices.forProducts(page)).thenReturn(byId);

        var result = service.categoryPage(category.id(), 0);

        assertThat(result.items()).hasSize(PAGE_SIZE - 1);
        assertThat(result.items().getFirst().image()).isEqualTo(new PublicCatalogImage(
                "/api/public/product-images/" + imageId + ".jpg", "Front", 800, 600));
        assertThat(result.items().get(1).image()).isNull();
        assertThat(result.items()).extracting(PublicProductCard::id)
                .doesNotContain(page.getLast().id());
        verify(images).findMainImages(page.stream().map(Product::id).toList());
        verify(prices).forProducts(page);
    }

    @Test
    void equipmentNeverExposesStoredMedicineFieldsOnCardsOrDetails() {
        var category = category("Devices");
        var equipment = product(category, ProductKind.EQUIPMENT, "generic stored", "Dosage stored");
        when(categories.findById(category.id())).thenReturn(Optional.of(category));
        when(products.countListed(category.id())).thenReturn(1L);
        when(products.findListed(category.id(), PageRequest.of(0, PAGE_SIZE))).thenReturn(List.of(equipment));
        when(images.findMainImages(List.of(equipment.id()))).thenReturn(List.of());
        var equipmentPrices = pricesFor(List.of(equipment));
        when(prices.forProducts(List.of(equipment))).thenReturn(equipmentPrices);
        when(products.findListedById(equipment.id())).thenReturn(Optional.of(equipment));
        when(images.findByProductIdOrderByDisplayOrder(equipment.id())).thenReturn(List.of());

        var card = service.categoryPage(category.id(), 0).items().getFirst();
        var details = service.product(equipment.id());

        assertThat(card.genericName()).isNull();
        assertThat(details.genericName()).isNull();
        assertThat(details.dosageForm()).isNull();
    }

    @Test
    void productDetailsReturnNotFoundWhenTheListedQueryFindsNoPurchasableProduct() {
        UUID id = UUID.randomUUID();
        when(products.findListedById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.product(id)).isInstanceOf(CatalogNotFoundException.class);
        verifyNoInteractions(images, prices);
    }

    @Test
    void detailsHideInactiveCategoryAndMapEveryImageInRepositoryOrder() {
        var category = mock(Category.class);
        UUID categoryId = UUID.randomUUID();
        when(category.id()).thenReturn(categoryId);
        when(category.name()).thenReturn("Hidden category");
        when(category.active()).thenReturn(false);
        var medicine = product(category, ProductKind.MEDICINE, "Paracetamol", "Tablet");
        UUID medicineId = medicine.id();
        when(products.findListedById(medicineId)).thenReturn(Optional.of(medicine));
        var first = image(UUID.randomUUID(), medicine.id(), "image/png", null, 400, 500);
        var second = image(UUID.randomUUID(), medicine.id(), "image/jpeg", "Side", 600, 700);
        when(images.findByProductIdOrderByDisplayOrder(medicine.id())).thenReturn(List.of(first, second));
        var medicinePrices = pricesFor(List.of(medicine));
        when(prices.forProducts(List.of(medicine))).thenReturn(medicinePrices);

        var details = service.product(medicineId);

        assertThat(details.category()).isNull();
        assertThat(details.images()).containsExactly(
                new PublicCatalogImage(ProductImageRules.publicPath(first.id(), first.contentType()),
                        null, 400, 500),
                new PublicCatalogImage(ProductImageRules.publicPath(second.id(), second.contentType()),
                        "Side", 600, 700));
        verify(images).findByProductIdOrderByDisplayOrder(medicineId);
        verify(prices).forProducts(List.of(medicine));
    }

    private static Category category(String name) {
        return new Category(UUID.randomUUID(), name, null, NOW);
    }

    private static List<Product> products(int count, Category category, ProductKind kind) {
        var result = new ArrayList<Product>();
        for (int index = 0; index < count; index++) result.add(product(category, kind, "Medicine " + index, "Tablet"));
        return result;
    }

    private static Product product(Category category, ProductKind kind, String genericName, String dosageForm) {
        var product = mock(Product.class);
        UUID id = UUID.randomUUID();
        UUID categoryId = category.id();
        var fields = new ProductRules.CatalogFields("Synthetic " + id, "Brand", genericName,
                "Manufacturer", dosageForm, "Strip of 10", "Synthetic description", categoryId, false, true);
        when(product.id()).thenReturn(id);
        when(product.kind()).thenReturn(kind);
        when(product.category()).thenReturn(category);
        when(product.fields()).thenReturn(fields);
        when(product.requireValidation()).thenReturn(false);
        when(product.sellingPrice()).thenReturn(Money.parse("20.00"));
        when(product.mrp()).thenReturn(null);
        return product;
    }

    private static ProductImage image(UUID id, UUID productId, String type, String alt, int width, int height) {
        var image = mock(ProductImage.class);
        when(image.id()).thenReturn(id);
        when(image.productId()).thenReturn(productId);
        when(image.contentType()).thenReturn(type);
        when(image.altText()).thenReturn(alt);
        when(image.width()).thenReturn(width);
        when(image.height()).thenReturn(height);
        return image;
    }

    private static Map<UUID, EffectivePrice> pricesFor(List<Product> products) {
        var result = new HashMap<UUID, EffectivePrice>();
        for (Product product : products) {
            UUID productId = product.id();
            result.put(productId, new EffectivePrice(productId, Money.parse("20.00"),
                    null, Money.parse("20.00"), new BigDecimal("0.00"), null, null, null, null, TODAY));
        }
        return result;
    }
}
