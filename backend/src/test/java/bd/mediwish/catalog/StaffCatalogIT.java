package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** T5 real-HTTP Product journey and contract against a run-owned PostgreSQL schema. */
@Tag("integration")
@Tag("security")
class StaffCatalogIT {
    @Test
    void moderatorCreatesAdminPricesAndActivatesThenRestartKeepsTheOffer() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var moderator = api.actor("MODERATOR");
            var admin = api.actor("ADMIN");
            var category = api.category(moderator, "Pain relief " + UUID.randomUUID());
            UUID categoryId = UUID.fromString((String) category.get("id"));
            var medicine = api.medicine(moderator, categoryId);
            String id = (String) medicine.get("id");
            assertThat(medicine).containsEntry("active", false).containsEntry("status", "NEEDS_PRICE")
                    .containsEntry("sellingPrice", null).containsEntry("version", 0);
            assertThat(changeTypes(medicine)).containsExactly("CREATED");

            assertError(api.send("PUT", "/api/staff/products/" + id, moderator,
                    CatalogTestApi.catalogBody(medicine, Map.of("active", true))), 409, "PRICE_REQUIRED");
            assertThat(api.get(moderator, id)).isEqualTo(medicine);
            Map<String, Object> forbiddenPrice = Map.of("sellingPrice", "11.50", "mrp", "12.00", "version", 0);
            assertError(api.send("PUT", "/api/staff/products/" + id + "/pricing", moderator, forbiddenPrice),
                    403, "ACCESS_DENIED");
            assertThat(api.database().single("SELECT selling_price FROM products WHERE id = ?", BigDecimal.class,
                    UUID.fromString(id))).isNull();
            assertThat(api.get(admin, id)).isEqualTo(medicine);

            var priced = api.price(admin, medicine, "11.50", "12.00");
            assertThat(priced).containsEntry("sellingPrice", "11.50").containsEntry("mrp", "12.00")
                    .containsEntry("version", 1).containsEntry("status", "INACTIVE");
            assertThat(changeTypes(priced)).containsExactly("PRICE_CHANGED", "CREATED");
            assertThat(history(priced).getFirst()).containsEntry("oldSellingPrice", null)
                    .containsEntry("newSellingPrice", "11.50").containsEntry("oldMrp", null)
                    .containsEntry("newMrp", "12.00").containsEntry("actorUsername", admin.username());
            assertThat(api.database().single("SELECT selling_price FROM products WHERE id = ?", BigDecimal.class,
                    UUID.fromString(id))).isEqualByComparingTo("11.50");

            var active = api.edit(moderator, priced, Map.of("active", true));
            assertThat(active).containsEntry("active", true).containsEntry("status", "ACTIVE")
                    .containsEntry("version", 2);
            assertThat(changeTypes(active)).containsExactly("ACTIVATED", "PRICE_CHANGED", "CREATED");
            var reviewRequired = api.edit(moderator, active, Map.of("requireValidation", true));
            assertThat(history(reviewRequired).getFirst()).containsEntry("changeType", "REQUIRE_VALIDATION_CHANGED")
                    .containsEntry("oldRequireValidation", false).containsEntry("newRequireValidation", true);

            var equipment = api.equipment(admin, categoryId);
            var equipmentPriced = api.price(admin, equipment, "450.00", null);
            var equipmentActive = api.edit(admin, equipmentPriced, Map.of("active", true));
            var equipmentInactive = api.edit(admin, equipmentActive, Map.of("active", false));
            assertThat(equipmentInactive).containsEntry("mrp", null).containsEntry("status", "INACTIVE");
            assertThat(changeTypes(equipmentInactive))
                    .containsExactly("DEACTIVATED", "ACTIVATED", "PRICE_CHANGED", "CREATED");
            assertThat(api.get(admin, equipment.get("id"))).isEqualTo(equipmentInactive);
            assertThat(itemIds(json(api.send("GET", "/api/staff/products?categoryId=" + categoryId
                    + "&status=INACTIVE", admin, null)))).contains((String) equipment.get("id"));

            api.application().restart();
            assertThat(api.get(moderator, id)).isEqualTo(reviewRequired);
            assertThat(api.get(admin, equipment.get("id"))).isEqualTo(equipmentInactive);
        }
    }

    @Test
    void listFiltersAndContractExamplesUseLiteralSearchAndExactMoneyStrings() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            var category = api.category(admin, "List category " + UUID.randomUUID());
            var other = api.category(admin, "Other category " + UUID.randomUUID());
            UUID categoryId = UUID.fromString((String) category.get("id"));
            UUID otherId = UUID.fromString((String) other.get("id"));
            String marker = UUID.randomUUID().toString().substring(0, 8);
            var draft = CatalogTestApi.draft("MEDICINE", categoryId);
            draft.put("name", "Medicine 100%_" + marker);
            draft.put("requireValidation", true);
            var needsPrice = api.createProduct(admin, draft);
            var underscoreControl = CatalogTestApi.draft("MEDICINE", categoryId);
            underscoreControl.put("name", "Alpha" + marker);
            api.createProduct(admin, underscoreControl);
            var inactive = api.price(admin, api.medicine(admin, categoryId), "11.50", "12.00");
            var active = api.edit(admin, api.price(admin, api.equipment(admin, otherId), "450.00", null),
                    Map.of("active", true));

            assertThat(itemIds(list(api, admin, "q=100%25_" + marker))).containsExactly((String) needsPrice.get("id"));
            assertThat(itemIds(list(api, admin, "q=0%25" + marker))).isEmpty();
            assertThat(itemIds(list(api, admin, "q=A_pha" + marker))).isEmpty();
            assertThat(itemIds(list(api, admin, "categoryId=" + categoryId + "&status=NEEDS_PRICE")))
                    .contains((String) needsPrice.get("id"));
            assertThat(itemIds(list(api, admin, "categoryId=" + categoryId + "&status=INACTIVE")))
                    .contains((String) inactive.get("id"));
            assertThat(itemIds(list(api, admin, "status=ACTIVE"))).contains((String) active.get("id"));
            assertThat(itemIds(list(api, admin, "reviewRequired=true")))
                    .contains((String) needsPrice.get("id"));
            assertThat(inactive).containsEntry("sellingPrice", "11.50").containsEntry("mrp", "12.00");
            assertThat(active).containsEntry("sellingPrice", "450.00").containsEntry("mrp", null);
            var noToken = api.send("GET", "/api/staff/products", (CatalogTestApi.Actor) null, null);
            assertError(noToken, 401, "AUTHENTICATION_REQUIRED");
        }
    }

    @Test
    void createRetryHasTheDocumentedStatusAndDifferentIntentConflicts() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID categoryId = UUID.fromString((String) api.category(admin, "Retry " + UUID.randomUUID()).get("id"));
            var draft = CatalogTestApi.draft("MEDICINE", categoryId);
            var created = api.createProduct(admin, draft);
            var retry = api.send("POST", "/api/staff/products", admin, draft);
            assertThat(retry.statusCode()).isEqualTo(200);
            assertThat(json(retry)).isEqualTo(created);
            var different = new LinkedHashMap<>(draft);
            different.put("name", "Different " + UUID.randomUUID());
            assertError(api.send("POST", "/api/staff/products", admin, different), 409, "ID_CONFLICT");
            assertThat(api.get(admin, created.get("id"))).isEqualTo(created);
        }
    }

    private static Map<String, Object> list(CatalogTestApi api, CatalogTestApi.Actor actor, String query)
            throws Exception {
        var response = api.send("GET", "/api/staff/products?" + query, actor, null);
        assertThat(response.statusCode()).isEqualTo(200);
        return json(response);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> history(Map<String, Object> product) {
        return (List<Map<String, Object>>) product.get("history");
    }

    private static List<String> changeTypes(Map<String, Object> product) {
        return history(product).stream().map(row -> (String) row.get("changeType")).toList();
    }

    @SuppressWarnings("unchecked")
    private static List<String> itemIds(Map<String, Object> page) {
        return ((List<Map<String, Object>>) page.get("items")).stream().map(item -> (String) item.get("id")).toList();
    }
}
