package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.catalog.PublicCatalogIT.category;
import static bd.mediwish.catalog.PublicCatalogIT.categoryActive;
import static bd.mediwish.catalog.PublicCatalogIT.image;
import static bd.mediwish.catalog.PublicCatalogIT.token;
import static bd.mediwish.catalog.DiscountTestApi.successful;
import static org.assertj.core.api.Assertions.assertThat;

/** T2 real-PostgreSQL proof for public catalog service projections and transaction-bound lazy data. */
@Tag("integration")
class PublicCatalogReadIT {
    @Test
    void readsListableCatalogPagesDetailsAndReorderedImagesInsideOneServiceTransaction() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            String prefix = "Read " + token() + " ";
            var listed = category(api, admin, prefix + "listed");
            var inactiveCategory = category(api, admin, prefix + "inactive");
            var inactiveOnly = category(api, admin, prefix + "inactive product");
            var empty = category(api, admin, prefix + "empty");
            var inactiveEquipmentOnly = category(api, admin, prefix + "inactive equipment");
            var equipmentOnly = category(api, admin, prefix + "equipment only");

            var apple = listed(api, admin, "MEDICINE", id(listed), "apple 1", "120.00");
            var banana = listed(api, admin, "MEDICINE", id(listed), "Banana 2", "120.00");
            var cherry = listed(api, admin, "MEDICINE", id(listed), "cherry 3", "120.00");
            UUID tieFirstId = UUID.fromString("00000000-0000-4000-8000-000000000001");
            UUID tieSecondId = UUID.fromString("00000000-0000-4000-8000-000000000002");
            var tieFirst = listed(api, admin, "MEDICINE", id(listed), tieFirstId, "same name", "120.00");
            var tieSecond = listed(api, admin, "MEDICINE", id(listed), tieSecondId, "same name", "120.00");

            var inactiveProduct = listed(api, admin, "MEDICINE", id(inactiveCategory), "inactive category product", "60.00");
            categoryActive(api, admin, inactiveCategory, false);
            var onlyInactive = listed(api, admin, "MEDICINE", id(inactiveOnly), "inactive product", "60.00");
            onlyInactive = api.edit(admin, onlyInactive, Map.of("active", false));
            var inactiveEquipment = listed(api, admin, "EQUIPMENT", id(inactiveEquipmentOnly), "inactive equipment", "60.00");
            inactiveEquipment = api.edit(admin, inactiveEquipment, Map.of("active", false));
            var equipment = listed(api, admin, "EQUIPMENT", id(equipmentOnly), "active equipment", "60.00");

            var first = image(api, admin, apple.get("id"), ProductImageTestApi.png(3, 2), "Front");
            var second = image(api, admin, apple.get("id"), ProductImageTestApi.png(2, 4), "Side");
            successful(api.send("PUT", "/api/staff/products/" + apple.get("id") + "/image-order", admin,
                    Map.of("imageIds", List.of(second.get("id"), first.get("id")),
                            "expectedImageIds", List.of(first.get("id"), second.get("id")))), 200);
            api.discount(admin, "CATEGORY", id(listed), "PERCENTAGE", "10", TODAY, null);

            var service = api.application().bean(PublicCatalogService.class);
            var publicCategories = service.categories().categories();
            var categoryIds = publicCategories.stream().map(PublicCategory::id).toList();
            assertThat(categoryIds).contains(id(listed), id(equipmentOnly))
                    .doesNotContain(id(inactiveCategory), id(inactiveOnly), id(empty), id(inactiveEquipmentOnly));

            var page = service.categoryPage(id(listed), 0);
            assertThat(page.items()).extracting(PublicProductCard::id)
                    .containsExactly(id(apple), id(banana), id(cherry), tieFirstId, tieSecondId);
            assertThat(page.items().getFirst().image()).isEqualTo(publicView(second));
            assertThat(page.items().getFirst().price().price()).isEqualTo("108.00");
            assertThat(page.items().getFirst().genericName()).isNotNull();
            var equipmentCard = service.categoryPage(id(equipmentOnly), 0).items().getFirst();
            assertThat(equipmentCard.genericName()).isNull();

            var medicineDetails = service.product(id(apple));
            assertThat(medicineDetails.category()).isEqualTo(new PublicCategory(
                    id(listed), (String) listed.get("name")));
            assertThat(medicineDetails.images()).containsExactly(publicView(second), publicView(first));
            assertThat(medicineDetails.price().price()).isEqualTo("108.00");
            assertThat(service.product(id(inactiveProduct)).category()).isNull();
            categoryActive(api, admin, listed, false);
            var deactivatedCategoryDetails = service.product(id(apple));
            assertThat(deactivatedCategoryDetails.category()).isNull();
            assertThat(deactivatedCategoryDetails.price().price()).isEqualTo("108.00");
            assertThat(service.product(id(equipment)).genericName()).isNull();
            assertThat(service.product(id(equipment)).dosageForm()).isNull();
            assertThat(new HashSet<>(page.items().stream().map(PublicProductCard::id).toList()))
                    .hasSameSizeAs(page.items());
        }
    }

    private static Map<String, Object> listed(DiscountTestApi api, CatalogTestApi.Actor admin, String kind,
            UUID categoryId, String name, String price) throws Exception {
        return listed(api, admin, kind, categoryId, UUID.randomUUID(), name, price);
    }

    private static Map<String, Object> listed(DiscountTestApi api, CatalogTestApi.Actor admin, String kind,
            UUID categoryId, UUID productId, String name, String price) throws Exception {
        var body = CatalogTestApi.draft(kind, categoryId);
        body.put("id", productId);
        body.put("name", name);
        var product = successful(api.send("POST", "/api/staff/products", admin, body), 201);
        product = api.price(admin, product, price);
        return api.edit(admin, product, Map.of("active", true));
    }

    private static PublicCatalogImage publicView(Map<String, Object> upload) {
        return new PublicCatalogImage((String) upload.get("url"), (String) upload.get("altText"),
                ((Number) upload.get("width")).intValue(), ((Number) upload.get("height")).intValue());
    }
}
