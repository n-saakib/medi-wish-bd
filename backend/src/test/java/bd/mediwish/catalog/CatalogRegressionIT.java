package bd.mediwish.catalog;

import bd.mediwish.testsupport.ApiAssertions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** T6 real-HTTP security and PostgreSQL regression guards for the staff catalog. */
@Tag("integration")
@Tag("regression")
@Tag("security")
@ExtendWith(OutputCaptureExtension.class)
class CatalogRegressionIT {
    @Test
    void unrepresentablePageOffsetsReturnBoundedErrorsOnBothListRoutes() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            api.category(admin, "Pagination guard category");
            for (String route : List.of("/api/staff/products", "/api/staff/categories")) {
                for (String query : List.of("page=107374183&size=20", "page=42949673&size=50",
                        "page=2147483647&size=2", "page=2147483647&size=50", "page=2147483648&size=1")) {
                    var response = api.send("GET", route + "?" + query, admin, null);
                    assertError(response, 400, "INVALID_REQUEST");
                    assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
                }
                for (String query : List.of("page=2147483647&size=1", "page=107374182&size=20",
                        "page=42949672&size=50", "page=2&size=20")) {
                    var response = api.send("GET", route + "?" + query, admin, null);
                    assertThat(response.statusCode()).isEqualTo(200);
                    assertThat(ApiAssertions.json(response).get("items")).asList().isEmpty();
                    assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
                }
            }
        }
    }

    @Test
    void duplicateJsonMembersUseTheLastValueBeforeCatalogValidation() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID id = UUID.randomUUID();
            // Characterizes the pinned HTTP JsonNode mapper; duplicate rejection is outside the T1 contract.
            String body = "{\"id\":\"" + id + "\",\"name\":\"Discarded synthetic name\","
                    + "\"name\":\"Retained synthetic name\"}";
            var created = api.send("POST", "/api/staff/categories", admin, body);
            assertThat(created.statusCode()).isEqualTo(201);
            assertThat(ApiAssertions.json(created)).containsEntry("id", id.toString())
                    .containsEntry("name", "Retained synthetic name");
            var replay = api.send("POST", "/api/staff/categories", admin,
                    Map.of("id", id, "name", "Retained synthetic name"));
            assertThat(replay.statusCode()).isEqualTo(200);
            assertThat(ApiAssertions.json(replay)).isEqualTo(ApiAssertions.json(created));
            String invalid = "{\"id\":\"" + UUID.randomUUID() + "\","
                    + "\"name\":\"Valid synthetic name\",\"name\":false}";
            assertError(api.send("POST", "/api/staff/categories", admin, invalid), 400, "INVALID_REQUEST");
            var list = api.send("GET", "/api/staff/categories", admin, null);
            assertThat(ApiAssertions.json(list).get("totalItems")).isEqualTo(1);
            assertThat(ApiAssertions.json(list).get("items")).asList().containsExactly(ApiAssertions.json(created));
        }
    }

    @Test
    void massAssignmentBulkBodiesAndOversizedValidJsonCannotChangeCatalog(CapturedOutput output) throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            String categoryName = "Guard " + UUID.randomUUID();
            UUID categoryId = UUID.fromString((String) api.category(admin, categoryName).get("id"));
            assertError(api.send("POST", "/api/staff/categories", admin,
                    Map.of("id", UUID.randomUUID(), "name", categoryName.toUpperCase())),
                    409, "CATEGORY_NAME_TAKEN");
            var product = api.medicine(admin, categoryId);
            String id = (String) product.get("id");
            for (String field : List.of("sellingPrice", "mrp", "price", "discount", "createdBy", "updatedBy",
                    "kind", "id")) {
                var body = CatalogTestApi.catalogBody(product, Map.of(field, "1.00"));
                assertError(api.send("PUT", "/api/staff/products/" + id, admin, body), 400, "INVALID_REQUEST");
                assertThat(api.get(admin, id)).as(field).isEqualTo(product);
            }
            var create = new LinkedHashMap<>(CatalogTestApi.draft("MEDICINE", categoryId));
            create.put("active", true);
            assertError(api.send("POST", "/api/staff/products", admin, create), 400, "INVALID_REQUEST");
            assertError(api.send("PUT", "/api/staff/products/" + id, admin,
                    List.of(CatalogTestApi.catalogBody(product, Map.of()))), 400, "INVALID_REQUEST");

            // The JSON remains otherwise valid: whitespace alone takes it past the 16 KiB request limit.
            String valid = "{\"sellingPrice\":\"11.50\",\"mrp\":null,\"version\":0}";
            String oversized = valid.substring(0, valid.length() - 1) + " ".repeat(17 * 1024) + "}";
            assertError(api.send("PUT", "/api/staff/products/" + id + "/pricing", admin, oversized),
                    400, "INVALID_REQUEST");
            String search = "PrivateSearch" + UUID.randomUUID().toString().substring(0, 8);
            assertThat(api.send("GET", "/api/staff/products?q=" + search, admin, null).statusCode()).isEqualTo(200);
            assertThat(api.get(admin, id)).isEqualTo(product);
            assertThat(api.database().single("SELECT count(*) FROM product_changes WHERE product_id = ?",
                    Long.class, UUID.fromString(id))).isOne();
            ApiAssertions.assertOmits("captured output", output.getAll(),
                    List.of(categoryName, categoryName.toUpperCase(), (String) product.get("name"),
                            "11.50", search, oversized));
        }
    }

    @Test
    void deactivationRetainsOldAuditValuesAndDatabaseGuardsPreventInvalidOffers() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID categoryId = UUID.fromString((String) api.category(admin, "Audit " + UUID.randomUUID()).get("id"));
            var unpriced = api.medicine(admin, categoryId);
            UUID unpricedId = UUID.fromString((String) unpriced.get("id"));
            assertConstraint(api, "UPDATE products SET active = true WHERE id = ?", "ck_products_active_priced",
                    unpricedId);
            assertConstraint(api, "UPDATE products SET mrp = 2.00 WHERE id = ?", "ck_products_mrp_needs_price",
                    unpricedId);
            assertConstraint(api, "UPDATE products SET selling_price = -1 WHERE id = ?",
                    "ck_products_selling_price_positive", unpricedId);
            assertConstraint(api, "UPDATE products SET selling_price = 3.00, mrp = 2.00 WHERE id = ?",
                    "ck_products_price_le_mrp", unpricedId);

            var priced = api.price(admin, unpriced, "11.50", "12.00");
            var active = api.edit(admin, priced, Map.of("active", true));
            var before = changes(api, unpricedId);
            assertThat(before).hasSize(3);
            var inactive = api.edit(admin, active, Map.of("active", false));
            var after = changes(api, unpricedId);
            assertThat(after).hasSize(4).containsAll(before);
            assertThat(inactive).containsEntry("status", "INACTIVE");
            assertThat(inactive.get("history")).as("old history still visible").isNotNull();
            assertThatThrownBy(() -> api.database().update("DELETE FROM products WHERE id = ?", unpricedId))
                    .isInstanceOf(SQLException.class).satisfies(error ->
                            assertThat(((SQLException) error).getSQLState()).isEqualTo("23001"));
            assertThatThrownBy(() -> api.database().update("DELETE FROM product_categories WHERE id = ?", categoryId))
                    .isInstanceOf(SQLException.class).satisfies(error ->
                            assertThat(((SQLException) error).getSQLState()).isEqualTo("23001"));
            assertThat(api.database().single("SELECT count(*) FROM product_categories WHERE id = ?",
                    Long.class, categoryId)).isOne();
            assertThat(changes(api, unpricedId)).containsExactlyElementsOf(after);

            var stockColumns = api.database().query("SELECT table_name || '.' || column_name "
                    + "FROM information_schema.columns WHERE table_schema = ? AND table_name IN "
                    + "('products','product_categories','product_changes') "
                    + "AND column_name ~* '(stock|quantity|qty|reserv|batch|expir|pack)'",
                    result -> result.getString(1), api.database().schema());
            assertThat(stockColumns).isEmpty();
            assertThat(api.get(admin, unpricedId)).isEqualTo(inactive);
        }
    }

    @Test
    void currentRoleAndMfaAreCheckedOnEveryStaffRoute() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            var moderator = api.actor("MODERATOR");
            var customer = api.actor("CUSTOMER");
            var courier = api.actor("DELIVERY_PERSON");
            var restricted = api.restrictedAdmin();
            UUID categoryId = UUID.fromString((String) api.category(admin, "Roles " + UUID.randomUUID()).get("id"));
            var product = api.medicine(admin, categoryId);
            String id = (String) product.get("id");
            var price = Map.of("sellingPrice", "11.50", "mrp", "12.00", "version", 0);

            // This Admin never held MODERATOR; both roles can use all non-pricing routes.
            assertThat(api.send("GET", "/api/staff/categories", admin, null).statusCode()).isEqualTo(200);
            assertThat(api.send("GET", "/api/staff/products", admin, null).statusCode()).isEqualTo(200);
            assertThat(api.send("GET", "/api/staff/products/" + id, moderator, null).statusCode()).isEqualTo(200);
            assertError(api.send("PUT", "/api/staff/products/" + id + "/pricing", moderator, price),
                    403, "ACCESS_DENIED");
            for (var actor : List.of(customer, courier, restricted)) {
                String code = actor == restricted ? "MFA_REQUIRED" : "ACCESS_DENIED";
                var categoryCreate = Map.of("id", UUID.randomUUID(), "name", "Refused " + UUID.randomUUID());
                var categoryUpdate = Map.of("name", "Refused", "active", false, "version", 0);
                var productCreate = CatalogTestApi.draft("MEDICINE", categoryId);
                var productUpdate = CatalogTestApi.catalogBody(product, Map.of("active", false));
                assertError(api.send("GET", "/api/staff/categories", actor, null), 403, code);
                assertError(api.send("POST", "/api/staff/categories", actor, categoryCreate), 403, code);
                assertError(api.send("PUT", "/api/staff/categories/" + categoryId, actor, categoryUpdate),
                        403, code);
                assertError(api.send("GET", "/api/staff/products", actor, null), 403, code);
                assertError(api.send("GET", "/api/staff/products/" + id, actor, null), 403, code);
                assertError(api.send("POST", "/api/staff/products", actor, productCreate), 403, code);
                assertError(api.send("PUT", "/api/staff/products/" + id, actor, productUpdate), 403, code);
                assertError(api.send("PUT", "/api/staff/products/" + id + "/pricing", actor, price), 403, code);
            }
            api.replaceRole(admin, "CUSTOMER");
            assertError(api.send("PUT", "/api/staff/products/" + id + "/pricing", admin, price),
                    403, "ACCESS_DENIED");
            assertThat(api.get(moderator, id)).isEqualTo(product);
        }
    }

    private static void assertConstraint(CatalogTestApi api, String sql, String name, Object... parameters) {
        assertThatThrownBy(() -> api.database().update(sql, parameters)).isInstanceOf(SQLException.class)
                .satisfies(error -> {
                    SQLException exception = (SQLException) error;
                    assertThat(exception.getSQLState()).isEqualTo("23514");
                    assertThat(exception.getMessage()).contains(name);
                });
    }

    private static List<Change> changes(CatalogTestApi api, UUID id) throws SQLException {
        return api.database().query("SELECT id, change_type, old_selling_price, new_selling_price, old_mrp, new_mrp, "
                + "old_require_validation, new_require_validation, actor_user_id, request_id, occurred_at "
                + "FROM product_changes WHERE product_id = ? ORDER BY occurred_at, id", result ->
                new Change(result.getObject(1, UUID.class), result.getString(2), result.getBigDecimal(3),
                        result.getBigDecimal(4), result.getBigDecimal(5), result.getBigDecimal(6),
                        result.getObject(7, Boolean.class), result.getObject(8, Boolean.class),
                        result.getObject(9, UUID.class), result.getString(10), result.getTimestamp(11).toInstant()), id);
    }

    private record Change(UUID id, String type, BigDecimal oldPrice, BigDecimal newPrice, BigDecimal oldMrp,
                          BigDecimal newMrp, Boolean oldFlag, Boolean newFlag, UUID actor, String requestId,
                          Instant occurredAt) {}
}
