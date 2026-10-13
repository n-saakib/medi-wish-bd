package bd.mediwish.catalog;

import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Comparator;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.catalog.DiscountTestApi.items;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Representative query and payload measurements; no latency SLA or production-load claim. */
@Tag("integration")
class DiscountQueriesIT {
    @Test
    void oneCandidateQueryPricesTheWholePageAndDerivedHistoryAddsAtMostTwoStatements() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID category = id(api.category(admin));
            var products = new ArrayList<Map<String, Object>>();
            for (int i = 0; i < 20; i++) products.add(api.activeProduct(admin, category, "100.00"));
            var statistics = api.application().bean(EntityManagerFactory.class)
                    .unwrap(SessionFactory.class).getStatistics();
            statistics.setStatisticsEnabled(true);
            api.send("GET", "/api/staff/products?size=20", admin, null); // warm the same route.
            statistics.clear();
            var empty = api.send("GET", "/api/staff/products?size=20", admin, null);
            long withoutDiscounts = statistics.getPrepareStatementCount();
            assertThat(empty.statusCode()).isEqualTo(200);
            var expectedProductIds = products.stream().map(product -> product.get("id")).toList();
            var baselineRows = items(json(empty), "items");
            assertThat(baselineRows).extracting(row -> row.get("id"))
                    .containsExactlyInAnyOrderElementsOf(expectedProductIds);
            assertThat(baselineRows).allSatisfy(row -> assertThat(row)
                    .containsEntry("sellingPrice", "100.00").containsEntry("effectivePrice", "100.00")
                    .containsEntry("appliedDiscount", null));
            assertThat(statistics.getQueryStatistics(DiscountRepository.CANDIDATES).getExecutionCount()).isOne();
            statistics.clear();
            api.get(admin, products.getFirst().get("id"));
            long withoutHistory = statistics.getPrepareStatementCount();

            var first = api.discount(admin, "PRODUCT", id(products.getFirst()), "PERCENTAGE", "15", TODAY, null);
            api.discount(admin, "PRODUCT", id(products.get(1)), "FLAT", "2.00", TODAY, null);
            api.discount(admin, "PRODUCT", id(products.get(2)), "PERCENTAGE", "5", TODAY, null);
            var categoryWinner = api.discount(admin, "CATEGORY", category, "PERCENTAGE", "10", TODAY, null);
            api.discount(admin, "CATEGORY", category, "FLAT", "1.00", TODAY, null);
            statistics.clear();
            var discounted = api.send("GET", "/api/staff/products?size=20", admin, null);
            long withDiscounts = statistics.getPrepareStatementCount();
            assertThat(discounted.statusCode()).isEqualTo(200);
            var discountedRows = items(json(discounted), "items");
            assertThat(discountedRows).extracting(row -> row.get("id"))
                    .containsExactlyInAnyOrderElementsOf(expectedProductIds);
            assertThat(discountedRows).allSatisfy(row -> {
                boolean productWinner = products.getFirst().get("id").equals(row.get("id"));
                assertThat(row).containsEntry("sellingPrice", "100.00")
                        .containsEntry("effectivePrice", productWinner ? "85.00" : "90.00");
                assertThat(DiscountTestApi.object(row.get("appliedDiscount")))
                        .containsEntry("id", (productWinner ? first : categoryWinner).get("id"))
                        .containsEntry("targetType", productWinner ? "PRODUCT" : "CATEGORY")
                        .containsEntry("kind", "PERCENTAGE").containsEntry("value", productWinner ? "15" : "10")
                        .containsEntry("saving", productWinner ? "15.00" : "10.00");
            });
            assertThat(withDiscounts).isPositive().isEqualTo(withoutDiscounts);
            assertThat(statistics.getQueryStatistics(DiscountRepository.CANDIDATES).getExecutionCount()).isOne();
            statistics.clear();
            api.get(admin, products.getFirst().get("id"));
            long withHistory = statistics.getPrepareStatementCount();
            assertThat(withHistory).isLessThanOrEqualTo(withoutHistory + 2);

            // Growing relevant history and distinct ending actors must keep username work batched.
            var endingActors = new ArrayList<CatalogTestApi.Actor>();
            endingActors.add(admin);
            for (int i = 1; i < 5; i++) endingActors.add(api.actor("ADMIN"));
            var expectedEnds = new ArrayList<Map<String, Object>>();
            var firstEnd = api.end(endingActors.get(1), first);
            expectedEnds.add(endedEvent(firstEnd, endingActors.get(1)));
            for (int i = 0; i < 20; i++) {
                var discount = api.discount(admin, "PRODUCT", id(products.getFirst()), "PERCENTAGE",
                        Integer.toString(20 + i), TODAY, null);
                var actor = endingActors.get(i % endingActors.size());
                expectedEnds.add(endedEvent(api.end(actor, discount), actor));
            }
            // All manual end timestamps follow the stored fixture events and the 2020 start events.
            expectedEnds.sort(Comparator.comparing(event -> Instant.parse((String) event.get("occurredAt")),
                    Comparator.reverseOrder()));
            var latestTwenty = expectedEnds.subList(0, 20);
            statistics.clear();
            var detailed = api.get(admin, products.getFirst().get("id"));
            long fullHistory = statistics.getPrepareStatementCount();
            assertThat(items(detailed, "history")).hasSize(20);
            assertThat(api.database().single("SELECT count(*) FROM product_changes WHERE product_id = ?",
                    Long.class, id(products.getFirst()))).isEqualTo(3);
            var actualEnds = items(detailed, "history").stream().map(entry -> {
                Map<String, Object> event = new LinkedHashMap<>();
                for (String field : List.of("changeType", "occurredAt", "actorUsername", "discount")) {
                    event.put(field, entry.get(field));
                }
                return event;
            }).toList();
            assertThat(actualEnds).containsExactlyElementsOf(latestTwenty);
            assertThat(fullHistory).isLessThanOrEqualTo(withoutHistory + 2);
            System.out.printf("Discount query counts: page0=%d page5=%d detail0=%d detail5=%d detailMany=%d%n",
                    withoutDiscounts, withDiscounts, withoutHistory, withHistory, fullHistory);
        }
    }

    @Test
    void fiftyDiscountRowsHaveBoundedPayloadAndBatchedNamesCountsAndUsernames() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID category = namedCategory(api, admin, 0);
            var product = api.activeProduct(admin, category, "100.00");
            product = api.edit(admin, product, Map.of("name", "Synthetic " + "x".repeat(150)));
            var statistics = api.application().bean(EntityManagerFactory.class)
                    .unwrap(SessionFactory.class).getStatistics();
            statistics.setStatisticsEnabled(true);
            var expected = new LinkedHashMap<UUID, Map<String, Object>>();
            var productDiscount = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "1", TODAY, null);
            expected.put(id(productDiscount), Map.of("targetType", "PRODUCT", "targetId", product.get("id"),
                    "targetName", product.get("name"), "updatedByUsername", admin.username()));
            var categoryDiscount = api.discount(admin, "CATEGORY", category, "PERCENTAGE", "1", TODAY, null);
            expected.put(id(categoryDiscount), Map.of("targetType", "CATEGORY", "targetId", category.toString(),
                    "targetName", "Category 00 " + "x".repeat(68), "updatedByUsername", admin.username()));
            api.list(admin, "ACTIVE", 50);
            statistics.clear();
            var small = api.send("GET", "/api/staff/discounts?status=ACTIVE&size=50", admin, null);
            assertThat(small.statusCode()).isEqualTo(200);
            long smallRows = statistics.getPrepareStatementCount();
            var actors = new ArrayList<CatalogTestApi.Actor>();
            actors.add(admin);
            for (int i = 1; i < 5; i++) actors.add(api.actor("ADMIN"));
            for (int i = 2; i < 50; i++) {
                UUID target;
                String targetName;
                String targetType = i % 2 == 0 ? "CATEGORY" : "PRODUCT";
                if (i % 2 == 0) {
                    target = namedCategory(api, admin, i);
                    targetName = "Category %02d ".formatted(i) + "x".repeat(68);
                } else {
                    var targetProduct = api.activeProduct(admin, namedCategory(api, admin, i), "100.00");
                    targetName = "Target %02d ".formatted(i) + "x".repeat(150);
                    target = id(api.edit(admin, targetProduct, Map.of("name", targetName)));
                }
                var actor = actors.get(i % actors.size());
                var discount = api.discount(actor, targetType, target,
                        i % 3 == 0 ? "FLAT" : "PERCENTAGE", i % 3 == 0 ? "1.00" : "1", TODAY, null);
                expected.put(id(discount), Map.of("targetType", targetType, "targetId", target.toString(),
                        "targetName", targetName, "updatedByUsername", actor.username()));
            }
            statistics.clear();
            var full = api.send("GET", "/api/staff/discounts?status=ACTIVE&size=50", admin, null);
            long fiftyRows = statistics.getPrepareStatementCount();
            assertThat(full.statusCode()).isEqualTo(200);
            var rows = items(json(full), "items");
            assertThat(rows).hasSize(50);
            assertThat(rows.stream().map(DiscountTestApi::id).toList())
                    .containsExactlyInAnyOrderElementsOf(expected.keySet());
            for (var row : rows) {
                assertThat(row).containsAllEntriesOf(expected.get(id(row)));
                // Each Product has its own Category; only the original Category target owns one Product.
                Object expectedCount = "PRODUCT".equals(row.get("targetType")) ? null
                        : category.toString().equals(row.get("targetId")) ? 1 : 0;
                assertThat(row).containsEntry("productCount", expectedCount);
            }
            assertThat(rows.stream().map(row -> row.get("targetId")).distinct()).hasSize(50);
            assertThat(items(json(full), "items").stream().map(row -> row.get("updatedByUsername")).distinct()).hasSize(5);
            assertThat(json(full)).containsEntry("totalItems", 50)
                    .containsEntry("counts", Map.of("active", 50, "scheduled", 0));
            assertThat(full.body().getBytes(StandardCharsets.UTF_8).length).isLessThan(64 * 1024);
            // One extra count query is permitted when Spring no longer infers a partial page's total.
            assertThat(fiftyRows).isPositive().isLessThanOrEqualTo(smallRows + 1);
            System.out.printf("Discount list query counts: two=%d fifty=%d payloadBytes=%d%n", smallRows, fiftyRows,
                    full.body().getBytes(StandardCharsets.UTF_8).length);
        }
    }

    private static Map<String, Object> endedEvent(Map<String, Object> ended, CatalogTestApi.Actor actor) {
        return Map.of("changeType", "DISCOUNT_ENDED", "occurredAt", ended.get("updatedAt"),
                "actorUsername", actor.username(), "discount", Map.of("targetType", ended.get("targetType"),
                        "kind", ended.get("kind"), "value", ended.get("value")));
    }

    private static UUID namedCategory(DiscountTestApi api, CatalogTestApi.Actor actor, int number) throws Exception {
        var category = api.category(actor);
        var renamed = api.send("PUT", "/api/staff/categories/" + category.get("id"), actor,
                Map.of("name", "Category %02d ".formatted(number) + "x".repeat(68), "active", true,
                        "version", category.get("version")));
        assertThat(renamed.statusCode()).isEqualTo(200);
        return id(json(renamed));
    }
}
