package bd.mediwish.catalog;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.catalog.DiscountTestApi.items;
import static bd.mediwish.catalog.DiscountTestApi.object;
import static bd.mediwish.catalog.DiscountTestApi.successful;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * T5 anonymous storefront reads over real HTTP and PostgreSQL: listable categories, 24-card pages, details and one
 * bounded not-found. The shared harness checks {@code Cache-Control: no-store} and a generated {@code X-Request-ID}
 * on every response; {@link #read} adds the JSON type and the absence of {@code Set-Cookie}. The static fixture and
 * shape helpers are reused by {@code PublicCatalogRegressionIT} and {@code PublicCatalogQueriesIT}.
 */
@Tag("integration")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PublicCatalogIT {
    static final int PAGE_SIZE = 24;
    static final Set<String> CATEGORY_KEYS = Set.of("id", "name");
    static final Set<String> PAGE_KEYS = Set.of("category", "items", "page", "size", "totalItems");
    static final Set<String> CARD_KEYS = Set.of("id", "name", "genericName", "saleUnit", "image", "price");
    static final Set<String> DETAILS_KEYS = Set.of("id", "name", "brandName", "genericName", "dosageForm",
            "manufacturer", "saleUnit", "description", "requireValidation", "category", "images", "price");
    static final Set<String> IMAGE_KEYS = Set.of("url", "altText", "width", "height");
    static final Set<String> PRICE_KEYS = Set.of("sellingPrice", "mrp", "price", "saving", "discount");
    static final Set<String> DISCOUNT_KEYS = Set.of("targetType", "kind", "value");

    private DiscountTestApi api;
    private CatalogTestApi.Actor admin;
    private String token;
    private Map<String, Object> listedA;
    private Map<String, Object> emptyB;
    private Map<String, Object> onlyInactiveC;
    private Map<String, Object> inactiveD;
    private Map<String, Object> secondE;
    private Map<String, Object> thirdF;
    private List<Map<String, Object>> expectedA;
    private Map<String, Object> full;
    private Map<String, Object> equipment;
    private Map<String, Object> inactive;
    private Map<String, Object> draft;
    private Map<String, Object> inactiveInC;
    private Map<String, Object> inInactiveD;
    private List<Map<String, Object>> others;
    private List<Map<String, Object>> fullImages;

    @BeforeAll
    void seed() throws Exception {
        api = DiscountTestApi.start();
        admin = api.actor("ADMIN");
        token = token();
        String prefix = "Browse " + token + " ";
        // Mixed-case codes: lower-case order (ba, bb, bc) differs from byte order (Ba, Bc, bb).
        listedA = category(api, admin, prefix + "Ba");
        secondE = category(api, admin, prefix + "bb");
        thirdF = category(api, admin, prefix + "Bc");
        emptyB = category(api, admin, prefix + "empty");
        onlyInactiveC = category(api, admin, prefix + "inactive only");
        inactiveD = category(api, admin, prefix + "deactivated");

        var listed = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < 25; i++) {
            // aa, Ab, ac, Ad, ...: the first letter alternates case so byte order would interleave differently.
            String code = (i % 2 == 0 ? "a" : "A") + (char) ('a' + i);
            var fields = new LinkedHashMap<String, Object>(Map.of("name", prefix + code, "genericName",
                    "Generic " + code, "saleUnit", "Strip of " + (i + 1) + " tablets"));
            if (i == 0) {
                fields.put("brandName", "Brand " + token);
                fields.put("manufacturer", "Maker " + token);
                fields.put("dosageForm", "Capsule");
                fields.put("description", "First line " + token + ".\nSecond line.");
                fields.put("requireValidation", true);
            }
            listed.add(listed(api, admin, "MEDICINE", id(listedA), fields, "%d.00".formatted(100 + i)));
        }
        full = listed.getFirst();
        // Its lower-case name equals the last medicine's ("ay"), so only the id orders the two.
        equipment = listed(api, admin, "EQUIPMENT", id(listedA), Map.of("name", prefix + "AY"), "450.00");
        listed.add(equipment);
        expectedA = listed.stream().sorted(Comparator
                .comparing((Map<String, Object> product) -> ((String) product.get("name")).toLowerCase(Locale.ROOT))
                .thenComparing(product -> (String) product.get("id"))).toList();
        assertThat(expectedA).as("fixture order differs from byte order")
                .isNotEqualTo(listed.stream().sorted(Comparator.comparing(product -> (String) product.get("name")))
                        .toList());
        inactive = api.price(admin, draft(api, admin, "MEDICINE", id(listedA), Map.of("name", prefix + "ab hidden")),
                "90.00");
        draft = draft(api, admin, "MEDICINE", id(listedA), Map.of("name", prefix + "ac draft"));
        var front = image(api, admin, full.get("id"), ProductImageTestApi.png(3, 2), "Front " + token);
        var side = image(api, admin, full.get("id"), ProductImageTestApi.png(2, 4), null);
        var reordered = successful(api.send("PUT", "/api/staff/products/" + full.get("id") + "/image-order",
                admin, Map.of("imageIds", List.of(side.get("id"), front.get("id")),
                        "expectedImageIds", List.of(front.get("id"), side.get("id")))), 200);
        assertThat(items(reordered, "images")).extracting(item -> item.get("id"))
                .containsExactly(side.get("id"), front.get("id"));
        fullImages = List.of(publicImage(side), publicImage(front));
        api.discount(admin, "CATEGORY", id(listedA), "PERCENTAGE", "10", TODAY, null);

        others = List.of(listed(api, admin, "EQUIPMENT", id(secondE), Map.of("name", prefix + "E one"), "40.00"),
                listed(api, admin, "MEDICINE", id(thirdF), Map.of("name", prefix + "F one"), "30.00"));
        inactiveInC = api.price(admin, draft(api, admin, "MEDICINE", id(onlyInactiveC),
                Map.of("name", prefix + "C hidden")), "20.00");
        inInactiveD = listed(api, admin, "MEDICINE", id(inactiveD), Map.of("name", prefix + "D one"), "200.00");
        api.discount(admin, "CATEGORY", id(inactiveD), "PERCENTAGE", "5", TODAY, null);
        inactiveD = categoryActive(api, admin, inactiveD, false);
    }

    @AfterAll
    void close() throws Exception {
        if (api != null) api.close();
    }

    @Test
    void listableCategoriesAreEqualForAnonymousAdminAndInvalidBearerReadersInLowerCaseNameOrder() throws Exception {
        var anonymous = ok(api, "/api/categories");
        var authenticated = checked(api.send("GET", "/api/categories", admin, null));
        var invalidBearer = checked(api.application().send("GET", "/api/categories",
                Map.of("Authorization", "Bearer invalid"), null));
        assertThat(authenticated.statusCode()).isEqualTo(200);
        assertThat(invalidBearer.statusCode()).isEqualTo(200);
        assertThat(json(authenticated)).isEqualTo(anonymous);
        assertThat(json(invalidBearer)).isEqualTo(anonymous);

        assertThat(anonymous.keySet()).containsExactly("categories");
        var categories = items(anonymous, "categories");
        for (var category : categories) assertThat(category.keySet()).containsExactlyInAnyOrderElementsOf(CATEGORY_KEYS);
        var own = new HashSet<>(List.of(listedA.get("id"), secondE.get("id"), thirdF.get("id"), emptyB.get("id"),
                onlyInactiveC.get("id"), inactiveD.get("id")));
        // Empty, only-inactive-Product and inactive categories are absent; listable ones follow lower(name), id.
        assertThat(categories.stream().filter(category -> own.contains(category.get("id"))).toList())
                .containsExactly(publicCategory(listedA), publicCategory(secondE), publicCategory(thirdF));
    }

    @Test
    void categoryPagesHoldTwentyFourExactCardsInNameThenIdOrderAndRejectEveryOtherPageForm() throws Exception {
        String path = "/api/categories/" + listedA.get("id") + "/products";
        var first = ok(api, path);
        assertThat(first.keySet()).containsExactlyInAnyOrderElementsOf(PAGE_KEYS);
        assertThat(first).containsEntry("category", publicCategory(listedA)).containsEntry("page", 0)
                .containsEntry("size", PAGE_SIZE).containsEntry("totalItems", 26);
        var cards = items(first, "items");
        assertThat(cards).extracting(card -> card.get("id"))
                .containsExactlyElementsOf(ids(expectedA.subList(0, PAGE_SIZE)));
        for (int i = 0; i < cards.size(); i++) assertCard(cards.get(i), expectedA.get(i));
        var fullCard = cards.stream().filter(card -> card.get("id").equals(full.get("id"))).findFirst().orElseThrow();
        assertThat(object(fullCard.get("price"))).containsExactlyInAnyOrderEntriesOf(price("100.00", "90.00", "10.00",
                Map.of("targetType", "CATEGORY", "kind", "PERCENTAGE", "value", "10")));

        var second = ok(api, path + "?page=1");
        assertThat(second).containsEntry("page", 1).containsEntry("size", PAGE_SIZE).containsEntry("totalItems", 26);
        var rest = items(second, "items");
        assertThat(rest).extracting(card -> card.get("id"))
                .containsExactlyElementsOf(ids(expectedA.subList(PAGE_SIZE, 26)));
        for (int i = 0; i < rest.size(); i++) assertCard(rest.get(i), expectedA.get(PAGE_SIZE + i));

        // The page size is fixed: an explicit page 0 and any other query parameter change nothing.
        assertThat(ok(api, path + "?page=0")).isEqualTo(first);
        assertThat(ok(api, path + "?size=50")).isEqualTo(first);
        assertThat(ok(api, path + "?page=1&size=50")).isEqualTo(second);
        for (String page : List.of("2", "-1", "abc", "", "01", "+1", "%2B1", "1.0", "1234567890", "1&page=0")) {
            notFound(api, path + "?page=" + page);
        }
    }

    @Test
    void emptyActiveCategoriesHaveOnlyPageZeroAndInactiveUnknownOrMalformedCategoriesAreNotFound() throws Exception {
        for (var category : List.of(emptyB, onlyInactiveC)) {
            String path = "/api/categories/" + category.get("id") + "/products";
            assertThat(ok(api, path)).containsExactlyInAnyOrderEntriesOf(Map.of("category", publicCategory(category),
                    "items", List.of(), "page", 0, "size", PAGE_SIZE, "totalItems", 0));
            notFound(api, path + "?page=1");
        }
        var bodies = new HashSet<Map<String, Object>>();
        for (Object categoryId : List.of(inactiveD.get("id"), UUID.randomUUID(), "not-a-uuid")) {
            bodies.add(notFound(api, "/api/categories/" + categoryId + "/products"));
            bodies.add(notFound(api, "/api/categories/" + categoryId + "/products?page=0"));
        }
        assertThat(bodies).hasSize(1);
    }

    @Test
    void detailsCarryStorefrontFieldsOrderedImagesAndTheCurrentPriceOfEveryListedProduct() throws Exception {
        var details = details(api, full);
        assertThat(details).containsEntry("brandName", "Brand " + token).containsEntry("manufacturer", "Maker " + token)
                .containsEntry("genericName", "Generic aa").containsEntry("dosageForm", "Capsule")
                .containsEntry("saleUnit", "Strip of 1 tablets")
                .containsEntry("description", "First line " + token + ".\nSecond line.")
                .containsEntry("requireValidation", true).containsEntry("category", publicCategory(listedA))
                .containsEntry("images", fullImages);
        assertThat(object(items(details, "images").getFirst())).containsEntry("altText", null);
        assertThat(object(details.get("price"))).containsExactlyInAnyOrderEntriesOf(price("100.00", "90.00", "10.00",
                Map.of("targetType", "CATEGORY", "kind", "PERCENTAGE", "value", "10")));

        assertThat(details(api, equipment)).containsEntry("genericName", null).containsEntry("dosageForm", null)
                .containsEntry("brandName", null).containsEntry("manufacturer", null)
                .containsEntry("description", null).containsEntry("requireValidation", false)
                .containsEntry("images", List.of());

        // C1: an inactive category hides the breadcrumb only; its Discount still prices the Product.
        var orphan = details(api, inInactiveD);
        assertThat(orphan).containsEntry("category", null);
        assertThat(object(orphan.get("price"))).containsExactlyInAnyOrderEntriesOf(price("200.00", "190.00", "10.00",
                Map.of("targetType", "CATEGORY", "kind", "PERCENTAGE", "value", "5")));

        for (var product : expectedA) details(api, product);
        for (var product : others) details(api, product);
    }

    @Test
    void inactiveUnpricedUnknownAndMalformedProductIdsShareOneBoundedNotFoundBody() throws Exception {
        var bodies = new HashSet<Map<String, Object>>();
        for (Object productId : List.of(inactive.get("id"), draft.get("id"), inactiveInC.get("id"),
                UUID.randomUUID(), "not-a-uuid", "123")) {
            bodies.add(notFound(api, "/api/products/" + productId));
        }
        bodies.add(notFound(api, "/api/products/" + UUID.randomUUID() + "/price"));
        assertThat(bodies).as("only requestId differs, and it is removed").hasSize(1);
    }

    @Test
    void upperCaseIdsReadTheSameRecordsAsTheirLowerCaseFormLikeThePriceRoute() throws Exception {
        // P16: only the frontend pages refuse non-lower-case ids; the API keeps CatalogRequests.uuid's any-case form.
        String productId = (String) full.get("id");
        assertThat(ok(api, "/api/products/" + productId.toUpperCase(Locale.ROOT)))
                .isEqualTo(ok(api, "/api/products/" + productId));
        String categoryId = (String) listedA.get("id");
        assertThat(ok(api, "/api/categories/" + categoryId.toUpperCase(Locale.ROOT) + "/products"))
                .isEqualTo(ok(api, "/api/categories/" + categoryId + "/products"));
    }

    private void assertCard(Map<String, Object> card, Map<String, Object> product) throws Exception {
        assertCardShape(card);
        assertThat(card).containsEntry("id", product.get("id")).containsEntry("name", product.get("name"))
                .containsEntry("genericName", product.get("genericName"))
                .containsEntry("saleUnit", product.get("saleUnit"))
                .containsEntry("image", product == full ? fullImages.getFirst() : null);
        assertThat(object(card.get("price"))).isEqualTo(priceRoute(api, product.get("id")));
        assertThat(object(object(card.get("price")).get("discount")))
                .isEqualTo(Map.of("targetType", "CATEGORY", "kind", "PERCENTAGE", "value", "10"));
    }

    // ---- Shared fixture and shape helpers (also used by the T6 and T7 public catalog suites) ----

    static String token() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    static Map<String, Object> category(DiscountTestApi api, CatalogTestApi.Actor admin, String name)
            throws Exception {
        return successful(api.send("POST", "/api/staff/categories", admin,
                Map.of("id", UUID.randomUUID(), "name", name)), 201);
    }

    static Map<String, Object> categoryActive(DiscountTestApi api, CatalogTestApi.Actor admin,
            Map<String, Object> category, boolean active) throws Exception {
        return successful(api.send("PUT", "/api/staff/categories/" + category.get("id"), admin,
                Map.of("name", category.get("name"), "active", active, "version", category.get("version"))), 200);
    }

    /** An inactive, unpriced (draft) Product with the given catalog fields over the synthetic defaults. */
    static Map<String, Object> draft(DiscountTestApi api, CatalogTestApi.Actor admin, String kind, UUID categoryId,
            Map<String, Object> fields) throws Exception {
        var body = CatalogTestApi.draft(kind, categoryId);
        body.putAll(fields);
        return successful(api.send("POST", "/api/staff/products", admin, body), 201);
    }

    /** An active, priced Product: the only kind a public read may show. */
    static Map<String, Object> listed(DiscountTestApi api, CatalogTestApi.Actor admin, String kind, UUID categoryId,
            Map<String, Object> fields, String sellingPrice) throws Exception {
        return api.edit(admin, api.price(admin, draft(api, admin, kind, categoryId, fields), sellingPrice),
                Map.of("active", true));
    }

    /** Uploads one PNG through the staff multipart route; the display order may later be changed. */
    static Map<String, Object> image(DiscountTestApi api, CatalogTestApi.Actor admin, Object productId, byte[] png,
            String altText) throws Exception {
        String boundary = "public-catalog-" + UUID.randomUUID();
        var body = new ByteArrayOutputStream();
        part(body, boundary, "id", UUID.randomUUID().toString());
        if (altText != null) part(body, boundary, "altText", altText);
        body.writeBytes(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"fixture.png\""
                + "\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.writeBytes(png);
        body.writeBytes(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        try (var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            var request = HttpRequest.newBuilder(api.application().uri("/api/staff/products/" + productId + "/images"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .header("Authorization", "Bearer " + admin.token())
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build();
            return successful(client.send(request, HttpResponse.BodyHandlers.ofString()), 201);
        }
    }

    private static void part(ByteArrayOutputStream out, String boundary, String name, String value) {
        out.writeBytes(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value
                + "\r\n").getBytes(StandardCharsets.UTF_8));
    }

    /** The storefront image projection of a staff upload response. */
    static Map<String, Object> publicImage(Map<String, Object> upload) {
        var image = new LinkedHashMap<String, Object>();
        for (String key : List.of("url", "altText", "width", "height")) image.put(key, upload.get(key));
        return image;
    }

    static Map<String, Object> publicCategory(Map<String, Object> category) {
        return Map.of("id", category.get("id"), "name", category.get("name"));
    }

    static Map<String, Object> price(String sellingPrice, String price, String saving, Map<String, Object> discount) {
        var value = new LinkedHashMap<String, Object>();
        value.put("sellingPrice", sellingPrice);
        value.put("mrp", null);
        value.put("price", price);
        value.put("saving", saving);
        value.put("discount", discount);
        return value;
    }

    static List<Object> ids(List<Map<String, Object>> products) {
        return products.stream().map(product -> product.get("id")).toList();
    }

    /** One anonymous GET; every public response is JSON and never sets a cookie. */
    static HttpResponse<String> read(DiscountTestApi api, String path) throws Exception {
        return checked(api.send("GET", path, null, null));
    }

    static HttpResponse<String> checked(HttpResponse<String> response) {
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
        assertThat(response.headers().firstValue("Content-Type")).hasValueSatisfying(type ->
                assertThat(type).startsWith("application/json"));
        return response;
    }

    static Map<String, Object> ok(DiscountTestApi api, String path) throws Exception {
        return successful(read(api, path), 200);
    }

    /** Asserts the bounded {@code 404 NOT_FOUND} envelope and returns it without its per-response requestId. */
    static Map<String, Object> notFound(DiscountTestApi api, String path) throws Exception {
        var response = read(api, path);
        assertError(response, 404, "NOT_FOUND");
        var body = new LinkedHashMap<>(json(response));
        body.remove("requestId");
        return body;
    }

    /** {@code GET /api/products/{id}/price} without {@code productId}: the price every public read must embed. */
    static Map<String, Object> priceRoute(DiscountTestApi api, Object productId) throws Exception {
        var body = new LinkedHashMap<>(ok(api, "/api/products/" + productId + "/price"));
        assertThat(body.remove("productId")).isEqualTo(productId);
        return body;
    }

    /** Details with the exact contract keys, the Product's own fields and the price route's price. */
    static Map<String, Object> details(DiscountTestApi api, Map<String, Object> product) throws Exception {
        var details = ok(api, "/api/products/" + product.get("id"));
        assertDetailsShape(details);
        assertThat(details).containsEntry("id", product.get("id")).containsEntry("name", product.get("name"))
                .containsEntry("saleUnit", product.get("saleUnit"));
        assertThat(object(details.get("price"))).isEqualTo(priceRoute(api, product.get("id")));
        return details;
    }

    static void assertPageShape(Map<String, Object> page) {
        assertThat(page.keySet()).containsExactlyInAnyOrderElementsOf(PAGE_KEYS);
        assertThat(object(page.get("category")).keySet()).containsExactlyInAnyOrderElementsOf(CATEGORY_KEYS);
        for (var card : items(page, "items")) assertCardShape(card);
    }

    static void assertCardShape(Map<String, Object> card) {
        assertThat(card.keySet()).containsExactlyInAnyOrderElementsOf(CARD_KEYS);
        if (card.get("image") != null) {
            assertThat(object(card.get("image")).keySet()).containsExactlyInAnyOrderElementsOf(IMAGE_KEYS);
        }
        assertPriceShape(object(card.get("price")));
    }

    static void assertDetailsShape(Map<String, Object> details) {
        assertThat(details.keySet()).containsExactlyInAnyOrderElementsOf(DETAILS_KEYS);
        if (details.get("category") != null) {
            assertThat(object(details.get("category")).keySet()).containsExactlyInAnyOrderElementsOf(CATEGORY_KEYS);
        }
        for (var image : items(details, "images")) {
            assertThat(image.keySet()).containsExactlyInAnyOrderElementsOf(IMAGE_KEYS);
        }
        assertPriceShape(object(details.get("price")));
    }

    static void assertPriceShape(Map<String, Object> price) {
        assertThat(price.keySet()).containsExactlyInAnyOrderElementsOf(PRICE_KEYS);
        if (price.get("discount") != null) {
            assertThat(object(price.get("discount")).keySet()).containsExactlyInAnyOrderElementsOf(DISCOUNT_KEYS);
        }
    }
}
