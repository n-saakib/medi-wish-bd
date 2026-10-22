package bd.mediwish.catalog;

import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.catalog.DiscountTestApi.items;
import static bd.mediwish.catalog.DiscountTestApi.object;
import static bd.mediwish.catalog.PublicCatalogIT.PAGE_SIZE;
import static bd.mediwish.catalog.PublicCatalogIT.category;
import static bd.mediwish.catalog.PublicCatalogIT.image;
import static bd.mediwish.catalog.PublicCatalogIT.listed;
import static bd.mediwish.catalog.PublicCatalogIT.ok;
import static bd.mediwish.catalog.PublicCatalogIT.read;
import static bd.mediwish.catalog.PublicCatalogIT.token;
import static org.assertj.core.api.Assertions.assertThat;

/** T7 anonymous storefront query costs and worst-case payload sizes on an isolated synthetic catalog. */
@Tag("integration")
class PublicCatalogQueriesIT {
    // The frontend reads public JSON with readJsonResponse(response, 256 * 1024).
    private static final int FRONTEND_READ_LIMIT = 262_144;

    @Test
    void publicReadStatementCountsDoNotGrowWithCardsImagesOrListableCategories() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            String prefix = "Queries " + token() + " ";
            var small = category(api, admin, prefix + "small");
            var single = pictured(api, admin, id(small), prefix + "single", 1);
            var large = category(api, admin, prefix + "large");
            for (int i = 0; i < PAGE_SIZE; i++) pictured(api, admin, id(large), prefix + "%02d".formatted(i), 1);
            String smallPage = "/api/categories/" + small.get("id") + "/products";
            String largePage = "/api/categories/" + large.get("id") + "/products";
            var statistics = api.application().bean(EntityManagerFactory.class)
                    .unwrap(SessionFactory.class).getStatistics();
            statistics.setStatisticsEnabled(true);
            ok(api, "/api/categories");
            ok(api, smallPage);
            ok(api, "/api/products/" + single.get("id"));

            statistics.clear();
            assertThat(items(ok(api, "/api/categories"), "categories")).hasSize(2);
            long categories2 = statistics.getPrepareStatementCount();
            statistics.clear();
            assertThat(items(ok(api, smallPage), "items")).hasSize(1);
            long page1 = statistics.getPrepareStatementCount();
            statistics.clear();
            var full = items(ok(api, largePage), "items");
            long page24 = statistics.getPrepareStatementCount();
            assertThat(full).hasSize(PAGE_SIZE).allSatisfy(card -> {
                assertThat(card.get("image")).isNotNull();
                assertThat(object(card.get("price")).get("discount")).isNotNull();
            });
            statistics.clear();
            assertThat(items(ok(api, "/api/products/" + single.get("id")), "images")).hasSize(1);
            long details1 = statistics.getPrepareStatementCount();

            var gallery = pictured(api, admin, id(category(api, admin, prefix + "gallery")), prefix + "gallery",
                    ProductImageRules.MAX_IMAGES);
            statistics.clear();
            assertThat(items(ok(api, "/api/products/" + gallery.get("id")), "images"))
                    .hasSize(ProductImageRules.MAX_IMAGES);
            long details8 = statistics.getPrepareStatementCount();

            for (int i = 0; i < 17; i++) {
                listed(api, admin, "EQUIPMENT", id(category(api, admin, prefix + "listable %02d".formatted(i))),
                        Map.of("name", prefix + "listable %02d".formatted(i)), "10.00");
            }
            statistics.clear();
            assertThat(items(ok(api, "/api/categories"), "categories")).hasSize(20);
            long categories20 = statistics.getPrepareStatementCount();

            // Compare total prepared statements; retained reports have no per-query statistics key.
            // With main images present on every card, equal costs establish bounded batch reads.
            assertThat(page1).isPositive();
            assertThat(page24).as("category page cost is independent of the card count").isEqualTo(page1);
            assertThat(details1).isPositive();
            assertThat(details8).as("details cost is independent of the image count").isEqualTo(details1);
            assertThat(categories2).isPositive();
            assertThat(categories20).as("category list cost is independent of its length").isEqualTo(categories2);
            System.out.printf("T17 SQL counts: page1=%d page24=%d details1=%d details8=%d categories2=%d "
                    + "categories20=%d%n", page1, page24, details1, details8, categories2, categories20);
        }
    }

    @Test
    void largestCategoryPageAndDetailsStayBelowTheFrontendReadLimit() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            String prefix = "Payload " + token() + " ";
            var category = category(api, admin, prefix + "page");
            for (int i = 0; i < PAGE_SIZE; i++) {
                String start = prefix + "%02d ".formatted(i);
                var fields = Map.<String, Object>of("name", sized(start, 160), "genericName", sized(start, 200),
                        "saleUnit", sized(start, 80));
                var product = listed(api, admin, "MEDICINE", id(category), fields, "9999.99");
                image(api, admin, product.get("id"), ProductImageTestApi.png(2, 2), sized(start, 160));
                api.discount(admin, "PRODUCT", id(product), "FLAT", "15.00", TODAY, null);
            }
            var page = read(api, "/api/categories/" + category.get("id") + "/products");
            assertThat(page.statusCode()).isEqualTo(200);
            assertThat(items(DiscountTestApi.successful(page, 200), "items")).hasSize(PAGE_SIZE);
            int pageBytes = page.body().getBytes(StandardCharsets.UTF_8).length;

            String start = prefix + "details ";
            var fields = new LinkedHashMap<String, Object>();
            fields.put("name", sized(start, 160));
            fields.put("brandName", sized(start, 120));
            fields.put("genericName", sized(start, 200));
            fields.put("manufacturer", sized(start, 120));
            fields.put("dosageForm", sized(start, 120));
            fields.put("saleUnit", sized(start, 80));
            fields.put("description", sized(start + "first line.\nSecond line ", 4_000));
            fields.put("requireValidation", true);
            var product = listed(api, admin, "MEDICINE", id(category(api, admin, prefix + "details")), fields,
                    "9999.99");
            for (int i = 0; i < ProductImageRules.MAX_IMAGES; i++) {
                image(api, admin, product.get("id"), ProductImageTestApi.png(2, 2), sized(start + i + " ", 160));
            }
            api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "12", TODAY, null);
            var details = read(api, "/api/products/" + product.get("id"));
            assertThat(details.statusCode()).isEqualTo(200);
            assertThat(items(DiscountTestApi.successful(details, 200), "images")).hasSize(ProductImageRules.MAX_IMAGES);
            int detailsBytes = details.body().getBytes(StandardCharsets.UTF_8).length;

            assertThat(pageBytes).isLessThan(FRONTEND_READ_LIMIT);
            assertThat(detailsBytes).isLessThan(FRONTEND_READ_LIMIT);
            System.out.printf("T17 payload bytes: page24=%d details8=%d limit=%d%n", pageBytes, detailsBytes,
                    FRONTEND_READ_LIMIT);
        }
    }

    /** An active Product with {@code images} PNGs and a Product Discount. */
    private static Map<String, Object> pictured(DiscountTestApi api, CatalogTestApi.Actor admin, UUID categoryId,
            String name, int images) throws Exception {
        var product = listed(api, admin, "EQUIPMENT", categoryId, Map.of("name", name), "100.00");
        for (int i = 0; i < images; i++) image(api, admin, product.get("id"), ProductImageTestApi.png(2, 2), null);
        api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
        return product;
    }

    /** Distinct ASCII text of exactly {@code length} characters. */
    private static String sized(String start, int length) {
        assertThat(start.length()).isLessThan(length);
        return start + "x".repeat(length - start.length());
    }
}
