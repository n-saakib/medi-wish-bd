package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** T5 category persistence, uniqueness and pagination through the staff HTTP contract. */
@Tag("integration")
class StaffCategoryIT {
    @Test
    void categoriesAreRenamedAndDeactivatedWithoutBreakingExistingProducts() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var moderator = api.actor("MODERATOR");
            var admin = api.actor("ADMIN");
            String name = "Care " + UUID.randomUUID();
            var category = api.category(moderator, name);
            var product = api.medicine(admin, UUID.fromString((String) category.get("id")));
            assertThat(find(api, admin, (String) category.get("id"))).containsEntry("productCount", 1);

            var duplicate = api.send("POST", "/api/staff/categories", admin,
                    Map.of("id", UUID.randomUUID(), "name", name.toUpperCase()));
            assertError(duplicate, 409, "CATEGORY_NAME_TAKEN");
            var renamedResponse = api.send("PUT", "/api/staff/categories/" + category.get("id"), moderator,
                    Map.of("name", name + " and fever", "active", true, "version", 0));
            assertThat(renamedResponse.statusCode()).isEqualTo(200);
            var renamed = json(renamedResponse);
            assertThat(renamed).containsEntry("version", 1).containsEntry("productCount", 1);
            var deactivatedResponse = api.send("PUT", "/api/staff/categories/" + category.get("id"), admin,
                    Map.of("name", name + " and fever", "active", false, "version", 1));
            assertThat(deactivatedResponse.statusCode()).isEqualTo(200);
            var deactivated = json(deactivatedResponse);
            assertThat(deactivated).containsEntry("active", false).containsEntry("productCount", 1);
            assertThat(find(api, admin, (String) category.get("id"))).isEqualTo(deactivated);
            assertThat(list(api, admin, "includeInactive=false&page=0&size=20").get("items")).isEqualTo(List.of());

            var newProduct = CatalogTestApi.draft("MEDICINE", UUID.fromString((String) category.get("id")));
            var refusedCreate = api.send("POST", "/api/staff/products", moderator, newProduct);
            assertThat(refusedCreate.statusCode()).isEqualTo(400);
            assertThat(json(refusedCreate)).containsEntry("code", "INVALID_REQUEST");
            var changed = api.edit(moderator, product, Map.of("description", "Kept in inactive category"));
            assertThat(changed).containsEntry("categoryId", category.get("id"))
                    .containsEntry("categoryName", name + " and fever");
            assertThat(api.get(admin, product.get("id"))).isEqualTo(changed);
        }
    }

    @Test
    void twentyFiveCategoriesPageInCaseInsensitiveNameOrderAndValidateBounds() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            String marker = UUID.randomUUID().toString().substring(0, 8);
            List<String> expected = new ArrayList<>();
            for (int number = 25; number >= 1; number--) {
                String name = (number % 2 == 0 ? "page " : "PAGE ")
                        + marker + " " + String.format("%02d", number);
                api.category(admin, name);
                expected.addFirst(name);
            }
            List<String> names = new ArrayList<>();
            for (int page = 0; page < 3; page++) {
                var response = list(api, admin, "page=" + page + "&size=10");
                assertThat(response).containsEntry("page", page).containsEntry("size", 10)
                        .containsEntry("totalItems", 25);
                names.addAll(categoryNames(response));
                assertThat(categoryNames(response)).hasSize(page == 2 ? 5 : 10);
            }
            assertThat(names).containsExactlyElementsOf(expected);
            assertThat(categoryNames(list(api, admin, "page=3&size=10"))).isEmpty();
            for (String query : List.of("page=-1", "size=0", "size=51")) {
                var invalid = api.send("GET", "/api/staff/categories?" + query, admin, null);
                assertThat(invalid.statusCode()).isEqualTo(400);
                assertThat(json(invalid)).containsEntry("code", "INVALID_REQUEST");
            }
        }
    }

    @Test
    void categoryCreateRetryComparesNormalizedCurrentNameWithoutWriting() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            String name = "Retry category " + UUID.randomUUID();
            UUID id = UUID.randomUUID();
            var original = Map.of("id", id, "name", name);
            var created = api.send("POST", "/api/staff/categories", admin, original);
            assertThat(created.statusCode()).isEqualTo(201);
            var retry = api.send("POST", "/api/staff/categories", admin,
                    Map.of("id", id, "name", "  " + name + "  "));
            assertThat(retry.statusCode()).isEqualTo(200);
            assertThat(json(retry)).isEqualTo(json(created));
            assertError(api.send("POST", "/api/staff/categories", admin,
                    Map.of("id", id, "name", name + " changed")), 409, "ID_CONFLICT");
            var deactivated = api.send("PUT", "/api/staff/categories/" + id, admin,
                    Map.of("name", name, "active", false, "version", 0));
            assertThat(deactivated.statusCode()).isEqualTo(200);
            var afterDeactivation = api.send("POST", "/api/staff/categories", admin, original);
            assertThat(afterDeactivation.statusCode()).isEqualTo(200);
            assertThat(json(afterDeactivation)).isEqualTo(json(deactivated));
            assertThat(api.database().single("SELECT count(*) FROM product_categories WHERE id = ?", Long.class, id))
                    .isOne();
        }
    }

    private static Map<String, Object> list(CatalogTestApi api, CatalogTestApi.Actor actor, String query)
            throws Exception {
        var response = api.send("GET", "/api/staff/categories?" + query, actor, null);
        assertThat(response.statusCode()).isEqualTo(200);
        return json(response);
    }

    private static Map<String, Object> find(CatalogTestApi api, CatalogTestApi.Actor actor, String id)
            throws Exception {
        for (int page = 0; page < 10; page++) {
            var listed = list(api, actor, "page=" + page + "&size=50");
            for (var category : categories(listed)) if (id.equals(category.get("id"))) return category;
            if ((page + 1) * 50 >= ((Number) listed.get("totalItems")).intValue()) break;
        }
        throw new AssertionError("Category not listed");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> categories(Map<String, Object> page) {
        return (List<Map<String, Object>>) page.get("items");
    }

    private static List<String> categoryNames(Map<String, Object> page) {
        return categories(page).stream().map(category -> (String) category.get("name")).toList();
    }
}
