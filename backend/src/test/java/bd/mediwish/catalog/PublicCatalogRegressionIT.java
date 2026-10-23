package bd.mediwish.catalog;

import bd.mediwish.testsupport.ApiAssertions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.catalog.DiscountTestApi.items;
import static bd.mediwish.catalog.DiscountTestApi.object;
import static bd.mediwish.catalog.PublicCatalogIT.PAGE_SIZE;
import static bd.mediwish.catalog.PublicCatalogIT.assertDetailsShape;
import static bd.mediwish.catalog.PublicCatalogIT.assertPageShape;
import static bd.mediwish.catalog.PublicCatalogIT.category;
import static bd.mediwish.catalog.PublicCatalogIT.categoryActive;
import static bd.mediwish.catalog.PublicCatalogIT.details;
import static bd.mediwish.catalog.PublicCatalogIT.image;
import static bd.mediwish.catalog.PublicCatalogIT.listed;
import static bd.mediwish.catalog.PublicCatalogIT.notFound;
import static bd.mediwish.catalog.PublicCatalogIT.ok;
import static bd.mediwish.catalog.PublicCatalogIT.price;
import static bd.mediwish.catalog.PublicCatalogIT.priceRoute;
import static bd.mediwish.catalog.PublicCatalogIT.publicCategory;
import static bd.mediwish.catalog.PublicCatalogIT.token;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * T6 regression, security and recovery guards for the anonymous storefront reads, over real HTTP and PostgreSQL.
 *
 * <p>N/A, recorded rather than skipped: duplicate, stale or concurrent <em>commands</em> and lost-response replay do
 * not apply, because Ticket 17 adds only idempotent {@code GET}s and no mutation. Reads that overlap a state change
 * and reads across a restart are covered by the concurrency and restart tests below.
 */
@Tag("integration")
@Tag("regression")
@Tag("security")
@ExtendWith(OutputCaptureExtension.class)
class PublicCatalogRegressionIT {
    private static final Set<String> STAFF_KEYS = Set.of("version", "status", "active", "updatedBy", "updatedAt",
            "history", "productCount", "objectKey", "sha256", "byteSize", "contentType");

    @Test
    void deactivationClosesEveryPurchasePathAndAnInactiveCategoryKeepsItsProductReadable(CapturedOutput output)
            throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            String prefix = "Bypass " + token() + " ";
            var category = category(api, admin, prefix + "category");
            var product = listed(api, admin, "MEDICINE", id(category), Map.of("name", prefix + "aa"), "80.00");
            var other = listed(api, admin, "MEDICINE", id(category), Map.of("name", prefix + "ab"), "60.00");
            String details = "/api/products/" + product.get("id");
            String page = "/api/categories/" + category.get("id") + "/products";
            assertThat(listedIds(api, page)).containsExactly(product.get("id"), other.get("id"));

            product = api.edit(admin, product, Map.of("active", false));
            notFound(api, details);
            notFound(api, details + "/price");
            assertThat(listedIds(api, page)).containsExactly(other.get("id"));

            product = api.edit(admin, product, Map.of("active", true));
            assertThat(details(api, product)).containsEntry("category", publicCategory(category));
            assertThat(listedIds(api, page)).containsExactly(product.get("id"), other.get("id"));
            assertThat(categoryIds(api)).contains(category.get("id"));

            categoryActive(api, admin, category, false);
            notFound(api, page);
            assertThat(categoryIds(api)).doesNotContain(category.get("id"));
            assertThat(details(api, product)).containsEntry("category", null);
            assertLogsOmit(output, List.of(prefix, (String) category.get("id"), (String) product.get("id"),
                    (String) other.get("id")));
        }
    }

    @Test
    void injectedMarkupIsReturnedAsTheExactStoredStrings(CapturedOutput output) throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            // Within the category (80) and alt-text (160) limits, and free of the rejected ISO control characters.
            String categoryName = "\"><svg onload=alert(1)>";
            String name = "<script>alert(1)</script>";
            String description = "<img src=x onerror=alert(1)>";
            String altText = "<b>x</b>";
            var category = category(api, admin, categoryName);
            var product = listed(api, admin, "MEDICINE", id(category),
                    Map.of("name", name, "description", description), "25.00");
            image(api, admin, product.get("id"), ProductImageTestApi.png(2, 2), altText);

            assertThat(items(ok(api, "/api/categories"), "categories")).contains(publicCategory(category));
            var page = ok(api, "/api/categories/" + category.get("id") + "/products");
            assertThat(object(page.get("category"))).containsEntry("name", categoryName);
            var card = items(page, "items").getFirst();
            assertThat(card).containsEntry("name", name);
            assertThat(object(card.get("image"))).containsEntry("altText", altText);
            var details = details(api, product);
            assertThat(details).containsEntry("name", name).containsEntry("description", description);
            assertThat(object(details.get("category"))).containsEntry("name", categoryName);
            assertThat(object(items(details, "images").getFirst())).containsEntry("altText", altText);
            assertLogsOmit(output, List.of(categoryName, name, description, altText));
        }
    }

    @Test
    void everyPublicResponseHasOnlyTheContractKeysAndNoStaffField(CapturedOutput output) throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            String prefix = "Fields " + token() + " ";
            var category = category(api, admin, prefix + "category");
            var fields = new LinkedHashMap<String, Object>(Map.of("name", prefix + "aa", "brandName", prefix + "brand",
                    "manufacturer", prefix + "maker", "description", prefix + "description", "requireValidation", true));
            var medicine = listed(api, admin, "MEDICINE", id(category), fields, "150.00");
            image(api, admin, medicine.get("id"), ProductImageTestApi.png(2, 2), prefix + "front");
            image(api, admin, medicine.get("id"), ProductImageTestApi.png(2, 2), null);
            var equipment = listed(api, admin, "EQUIPMENT", id(category), Map.of("name", prefix + "ab"), "75.00");
            api.discount(admin, "PRODUCT", id(medicine), "FLAT", "15.00", TODAY, null);

            String page = "/api/categories/" + category.get("id") + "/products";
            var list = ok(api, "/api/categories");
            assertThat(list.keySet()).containsExactly("categories");
            for (var entry : items(list, "categories")) {
                assertThat(entry.keySet()).containsExactlyInAnyOrderElementsOf(PublicCatalogIT.CATEGORY_KEYS);
            }
            var cards = ok(api, page);
            assertPageShape(cards);
            var medicineDetails = ok(api, "/api/products/" + medicine.get("id"));
            var equipmentDetails = ok(api, "/api/products/" + equipment.get("id"));
            assertDetailsShape(medicineDetails);
            assertDetailsShape(equipmentDetails);
            assertThat(object(medicineDetails.get("price"))).isEqualTo(priceRoute(api, medicine.get("id")))
                    .containsEntry("discount", Map.of("targetType", "PRODUCT", "kind", "FLAT", "value", "15.00"));
            for (var body : List.of(list, cards, medicineDetails, equipmentDetails)) {
                assertThat(allKeys(body)).doesNotContainAnyElementsOf(STAFF_KEYS);
            }

            // Page values and ids travel only in the URL; neither they nor the seeded text may reach the log.
            notFound(api, page + "?page=918273645");
            notFound(api, page + "?page=1234567890");
            assertLogsOmit(output, List.of(prefix, (String) category.get("id"), (String) medicine.get("id"),
                    (String) equipment.get("id"), "918273645", "1234567890"));
        }
    }

    @Test
    void aDiscountStartingTomorrowAppliesOnTheFirstReadOfTheNextDhakaDayWithoutRestart(CapturedOutput output)
            throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            String prefix = "Fresh " + token() + " ";
            var category = category(api, admin, prefix + "category");
            var product = listed(api, admin, "EQUIPMENT", id(category), Map.of("name", prefix + "aa"), "200.00");
            api.discount(admin, "CATEGORY", id(category), "PERCENTAGE", "20", TODAY.plusDays(1), null);
            String page = "/api/categories/" + category.get("id") + "/products";

            var scheduled = price("200.00", "200.00", "0.00", null);
            assertThat(object(details(api, product).get("price"))).isEqualTo(scheduled);
            assertThat(object(items(ok(api, page), "items").getFirst().get("price"))).isEqualTo(scheduled);

            api.today(TODAY.plusDays(1));
            var started = price("200.00", "160.00", "40.00",
                    Map.of("targetType", "CATEGORY", "kind", "PERCENTAGE", "value", "20"));
            assertThat(object(items(ok(api, page), "items").getFirst().get("price"))).isEqualTo(started);
            assertThat(object(details(api, product).get("price"))).isEqualTo(started);
            assertLogsOmit(output, List.of(prefix, (String) category.get("id"), (String) product.get("id")));
        }
    }

    @Test
    void readersOverlappingRepeatedDeactivationAlwaysSeeOneConsistentSnapshot(CapturedOutput output)
            throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            String prefix = "Snapshot " + token() + " ";
            var category = category(api, admin, prefix + "category");
            var products = new ArrayList<Map<String, Object>>();
            for (int i = 0; i < 30; i++) {
                String code = "" + (char) ('a' + i / 26) + (char) ('a' + i % 26);
                products.add(listed(api, admin, "EQUIPMENT", id(category), Map.of("name", prefix + code), "10.00"));
            }
            // The fourth by name is always on page 0, so its presence must agree with the count in each response.
            var toggled = products.get(3);
            String page = "/api/categories/" + category.get("id") + "/products";
            // Three readers and one writer: the Hikari pool holds 4 connections with a 1000 ms connection timeout.
            // Witness both states before the remaining toggles race with the readers.
            var barrier = new CyclicBarrier(4);
            try (var executor = Executors.newFixedThreadPool(4)) {
                var tasks = new ArrayList<Future<?>>();
                for (int reader = 0; reader < 3; reader++) {
                    tasks.add(executor.submit(() -> {
                        barrier.await(30, TimeUnit.SECONDS);
                        assertThat(assertSnapshot(api, page, toggled.get("id"))).isEqualTo(29L);
                        barrier.await(30, TimeUnit.SECONDS);
                        barrier.await(30, TimeUnit.SECONDS);
                        assertThat(assertSnapshot(api, page, toggled.get("id"))).isEqualTo(30L);
                        barrier.await(30, TimeUnit.SECONDS);
                        for (int read = 0; read < 18; read++) assertSnapshot(api, page, toggled.get("id"));
                        return null;
                    }));
                }
                tasks.add(executor.submit(() -> {
                    var current = toggled;
                    current = api.edit(admin, current, Map.of("active", false));
                    barrier.await(30, TimeUnit.SECONDS);
                    barrier.await(30, TimeUnit.SECONDS);
                    current = api.edit(admin, current, Map.of("active", true));
                    barrier.await(30, TimeUnit.SECONDS);
                    barrier.await(30, TimeUnit.SECONDS);
                    for (int round = 1; round < 10; round++) {
                        current = api.edit(admin, current, Map.of("active", false));
                        current = api.edit(admin, current, Map.of("active", true));
                    }
                    return null;
                }));
                for (var task : tasks) task.get(90, TimeUnit.SECONDS);
            }
            var settled = ok(api, page);
            assertThat(settled).containsEntry("totalItems", 30);
            assertThat(items(settled, "items")).hasSize(PAGE_SIZE);
            assertLogsOmit(output, List.of(prefix, (String) category.get("id"), (String) toggled.get("id")));
        }
    }

    @Test
    void restartedApplicationReturnsTheSameThreePublicBodies(CapturedOutput output) throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            String prefix = "Restart " + token() + " ";
            var category = category(api, admin, prefix + "category");
            var product = listed(api, admin, "MEDICINE", id(category), Map.of("name", prefix + "aa"), "50.00");
            image(api, admin, product.get("id"), ProductImageTestApi.png(2, 2), prefix + "front");
            api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            var paths = List.of("/api/categories", "/api/categories/" + category.get("id") + "/products",
                    "/api/products/" + product.get("id"));
            var before = new ArrayList<Map<String, Object>>();
            for (String path : paths) before.add(ok(api, path));

            // restart() re-reads the calendar bean from application(); the public reads keep no in-memory state.
            api.restart(TODAY);
            var after = new ArrayList<Map<String, Object>>();
            for (String path : paths) after.add(ok(api, path));
            assertThat(after).isEqualTo(before);
            assertLogsOmit(output, List.of(prefix, (String) category.get("id"), (String) product.get("id")));
        }
    }

    @Test
    void oversizedIdsAndPagesAreBoundedClientErrorsThatNeverEchoTheValue(CapturedOutput output) throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var category = category(api, admin, "Oversized " + token());
            listed(api, admin, "EQUIPMENT", id(category), Map.of(), "10.00");
            String longId = "7c".repeat(2_500);
            String echo = "7c".repeat(8);
            for (String path : List.of("/api/products/" + longId, "/api/categories/" + longId + "/products")) {
                // Raw client: a request Tomcat refused before Spring would lack the harness's shared headers.
                var response = raw(api, path);
                assertThat(response.statusCode()).as("bounded client error").isBetween(400, 499);
                assertThat(response.body()).hasSizeLessThan(512).doesNotContain(echo);
                System.out.printf("T17 oversized id path: route=%s status=%d bodyBytes=%d%n",
                        path.startsWith("/api/products/") ? "details" : "category", response.statusCode(),
                        response.body().length());
            }
            String page = "/api/categories/" + category.get("id") + "/products";
            notFound(api, page + "?page=1234567890");
            notFound(api, page + "?page=" + "9".repeat(5_000));
            assertLogsOmit(output, List.of(echo, "9".repeat(16), "1234567890"));
        }
    }

    private static long assertSnapshot(DiscountTestApi api, String page, Object toggledId) throws Exception {
        var response = api.send("GET", page, null, null);
        assertThat(response.statusCode()).isEqualTo(200);
        var body = json(response);
        long total = ((Number) body.get("totalItems")).longValue();
        assertThat(total).isBetween(29L, 30L);
        var cards = items(body, "items");
        var ids = cards.stream().map(card -> card.get("id")).toList();
        assertThat(ids).hasSize((int) Math.min(PAGE_SIZE, total));
        assertThat(new HashSet<>(ids)).hasSameSizeAs(ids);
        assertThat(ids.contains(toggledId)).as("count and page come from one snapshot").isEqualTo(total == 30);
        for (var card : cards) {
            assertThat(object(card.get("price"))).containsExactlyInAnyOrderEntriesOf(
                    price("10.00", "10.00", "0.00", null));
        }
        return total;
    }

    private static List<Object> listedIds(DiscountTestApi api, String page) throws Exception {
        return items(ok(api, page), "items").stream().map(card -> card.get("id")).toList();
    }

    private static List<Object> categoryIds(DiscountTestApi api) throws Exception {
        return items(ok(api, "/api/categories"), "categories").stream().map(entry -> entry.get("id")).toList();
    }

    private static HttpResponse<String> raw(DiscountTestApi api, String path) throws Exception {
        try (var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            return client.send(HttpRequest.newBuilder(api.application().uri(path)).timeout(Duration.ofSeconds(10))
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    private static Set<String> allKeys(Object value) {
        var keys = new HashSet<String>();
        if (value instanceof Map<?, ?> map) {
            map.forEach((key, child) -> {
                keys.add((String) key);
                keys.addAll(allKeys(child));
            });
        } else if (value instanceof List<?> list) {
            list.forEach(child -> keys.addAll(allKeys(child)));
        }
        return keys;
    }

    private static void assertLogsOmit(CapturedOutput output, List<String> values) {
        ApiAssertions.assertOmits("captured output", output.getAll(), values);
    }
}
