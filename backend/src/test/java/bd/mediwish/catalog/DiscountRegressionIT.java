package bd.mediwish.catalog;

import bd.mediwish.testsupport.ApiAssertions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.catalog.DiscountTestApi.items;
import static bd.mediwish.catalog.StaffDiscountIT.assertPrice;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** R1: no unrelated writes, immutable value snapshots, no compounding, durable replay and private logs. */
@Tag("integration")
@Tag("regression")
@ExtendWith(OutputCaptureExtension.class)
class DiscountRegressionIT {
    @Test
    void everyDiscountMutationLeavesAllUnrelatedTablesAndStoredProductPricesUntouched() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "100.00");
            Map<String, String> before = fingerprints(api);
            assertThat(before).containsKeys("products", "product_changes", "users", "user_roles");
            String productBefore = api.database().single("SELECT to_jsonb(p)::text FROM products p WHERE id = ?",
                    String.class, id(product));
            var discount = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            assertThat(fingerprints(api)).isEqualTo(before);
            discount = api.update(admin, discount, Map.of("value", "20"));
            assertThat(fingerprints(api)).isEqualTo(before);
            api.end(admin, discount);
            assertThat(fingerprints(api)).isEqualTo(before);
            assertThat(api.database().single("SELECT to_jsonb(p)::text FROM products p WHERE id = ?",
                    String.class, id(product))).isEqualTo(productBefore);
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ?",
                    Long.class, id(discount))).isEqualTo(3);
        }
    }

    @Test
    void repeatedListDetailAndAnonymousReadsAlwaysUseTheStoredSellingPriceOnce() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID category = id(api.category(admin));
            var product = api.activeProduct(admin, category, "100.00");
            api.discount(admin, "CATEGORY", category, "PERCENTAGE", "10", TODAY, null);
            var productDiscount = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            for (int read = 0; read < 10; read++) {
                assertPrice(api.get(admin, product.get("id")), "90.00", productDiscount.get("id"));
                assertThat(json(api.send("GET", "/api/products/" + product.get("id") + "/price", null, null)))
                        .containsEntry("sellingPrice", "100.00").containsEntry("price", "90.00")
                        .containsEntry("saving", "10.00");
            }
            var page = json(api.send("GET", "/api/staff/products?size=20", admin, null));
            assertThat(items(page, "items")).singleElement().satisfies(row ->
                    assertPrice(row, "90.00", productDiscount.get("id")));
            assertThat(api.database().single("SELECT selling_price::text FROM products WHERE id = ?",
                    String.class, id(product))).isEqualTo("100.00");
        }
    }

    @Test
    void snapshotCapturedWithoutACallerTransactionSurvivesLaterEditAndEnd() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "100.00");
            var discount = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            CurrentPrices prices = api.application().bean(CurrentPrices.class);
            // This thread has no Spring transaction and open-in-view remains disabled.
            EffectivePrice captured = prices.forProduct(id(product)).orElseThrow();
            Map<String, Object> before = snapshotValues(captured);
            assertThat(before).containsEntry("productId", id(product)).containsEntry("sellingPrice", "100.00")
                    .containsEntry("mrp", null).containsEntry("price", "90.00").containsEntry("discountId", id(discount))
                    .containsEntry("discountTarget", DiscountTargetType.PRODUCT)
                    .containsEntry("discountKind", DiscountKind.PERCENTAGE).containsEntry("pricedOn", TODAY);
            assertThat(captured.saving()).isEqualByComparingTo("10.00");
            assertThat(captured.discountValue()).isEqualByComparingTo("10");
            discount = api.update(admin, discount, Map.of("value", "20"));
            var changed = prices.forProduct(id(product)).orElseThrow();
            assertThat(snapshotValues(changed)).containsEntry("productId", id(product))
                    .containsEntry("sellingPrice", "100.00").containsEntry("mrp", null).containsEntry("price", "80.00")
                    .containsEntry("discountId", id(discount)).containsEntry("discountTarget", DiscountTargetType.PRODUCT)
                    .containsEntry("discountKind", DiscountKind.PERCENTAGE).containsEntry("pricedOn", TODAY);
            assertThat(changed.saving()).isEqualByComparingTo("20.00");
            assertThat(changed.discountValue()).isEqualByComparingTo("20");
            assertThat(snapshotValues(captured)).isEqualTo(before);
            api.end(admin, discount);
            var fresh = prices.forProduct(id(product)).orElseThrow();
            assertThat(snapshotValues(fresh)).containsEntry("productId", id(product))
                    .containsEntry("sellingPrice", "100.00").containsEntry("mrp", null).containsEntry("price", "100.00")
                    .containsEntry("discountId", null).containsEntry("discountTarget", null)
                    .containsEntry("discountKind", null).containsEntry("discountValue", null).containsEntry("pricedOn", TODAY);
            assertThat(fresh.saving()).isEqualByComparingTo("0.00");
            assertThat(snapshotValues(captured)).isEqualTo(before);
        }
    }

    @Test
    void pricingChangeRecomputesTheDiscountAndPersistsOnlyTheSellingPriceInProductHistory() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "100.00");
            var discount = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            long before = api.database().single("SELECT count(*) FROM product_changes WHERE product_id = ?",
                    Long.class, id(product));
            product = api.price(admin, product, "200.00");
            assertPrice(product, "180.00", discount.get("id"));
            assertThat(api.database().single("SELECT count(*) FROM product_changes WHERE product_id = ?",
                    Long.class, id(product))).isEqualTo(before + 1);
            var latest = api.database().query("SELECT change_type, old_selling_price::text, new_selling_price::text "
                            + "FROM product_changes WHERE product_id = ? ORDER BY occurred_at DESC, id LIMIT 1",
                    row -> List.of(row.getString(1), row.getString(2), row.getString(3)), id(product));
            assertThat(latest).containsExactly(List.of("PRICE_CHANGED", "100.00", "200.00"));
        }
    }

    @Test
    void restartAndLostCreateUpdateAndEndResponsesPreserveOneAuditRowPerActualMutation() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID category = id(api.category(admin));
            UUID discountId = UUID.randomUUID();
            var body = DiscountTestApi.createBody(discountId, "CATEGORY", category, "PERCENTAGE", "10", TODAY, null);
            var created = api.send("POST", "/api/staff/discounts", admin, body);
            assertThat(created.statusCode()).isEqualTo(201);
            var firstView = json(created);
            api.restart(TODAY);
            var replay = api.send("POST", "/api/staff/discounts", admin, body);
            assertThat(replay.statusCode()).isEqualTo(200);
            assertThat(json(replay)).isEqualTo(firstView);
            var update = DiscountTestApi.updateBody(firstView, Map.of("value", "20"));
            // Consume only the status, dropping the response body as after transport loss.
            assertThat(api.send("PUT", "/api/staff/discounts/" + discountId, admin, update).statusCode()).isEqualTo(200);
            var updated = api.send("PUT", "/api/staff/discounts/" + discountId, admin, update);
            assertThat(updated.statusCode()).isEqualTo(200);
            assertThat(json(updated)).containsEntry("version", 1).containsEntry("value", "20");
            var end = Map.of("version", json(updated).get("version"));
            assertThat(api.send("POST", "/api/staff/discounts/" + discountId + "/end", admin, end).statusCode())
                    .isEqualTo(200);
            var ended = api.send("POST", "/api/staff/discounts/" + discountId + "/end", admin, end);
            assertThat(ended.statusCode()).isEqualTo(200);
            assertThat(json(ended)).containsEntry("status", "ENDED").containsEntry("version", 2);
            assertThat(api.database().single("SELECT count(*) FROM discounts WHERE id = ?", Long.class, discountId)).isOne();
            for (String change : List.of("CREATED", "UPDATED", "ENDED")) {
                assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                        + "AND change_type = ?", Long.class, discountId, change)).isOne();
            }
        }
    }

    @Test
    @Tag("security")
    void mutationLogsOmitTargetNamesMoneyAndCredentialsAndDemotedTokensCannotMutate(CapturedOutput output)
            throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "9876.53");
            var discount = api.discount(admin, "PRODUCT", id(product), "FLAT", "4321.87", TODAY, null);
            discount = api.update(admin, discount, Map.of("value", "4322.89"));
            api.end(admin, discount);
            var mutable = api.discount(admin, "PRODUCT", id(product), "FLAT", "4323.91", TODAY, null);
            assertThat(api.database().update("UPDATE user_roles SET role = 'MODERATOR' WHERE user_id = ?",
                    admin.userId())).isOne();
            String discountBefore = discountFingerprint(api);
            Map<String, String> unrelatedBefore = fingerprints(api);
            var refused = List.of(
                    api.send("GET", "/api/staff/discounts?status=ACTIVE", admin, null),
                    api.send("POST", "/api/staff/discounts", admin,
                            DiscountTestApi.createBody(UUID.randomUUID(), "PRODUCT", id(product), "FLAT", "4325.97",
                                    TODAY, null)),
                    api.send("PUT", "/api/staff/discounts/" + mutable.get("id"), admin,
                            DiscountTestApi.updateBody(mutable, Map.of("value", "4324.93"))),
                    api.send("POST", "/api/staff/discounts/" + mutable.get("id") + "/end", admin,
                            Map.of("version", mutable.get("version"))));
            var sentinels = List.of(admin.token(), "9876.53", "4321.87", "4322.89", "4323.91", "4324.93",
                    "4325.97", (String) product.get("name"));
            for (var response : refused) {
                assertError(response, 403, "ACCESS_DENIED");
                ApiAssertions.assertOmits(response, sentinels);
            }
            assertThat(discountFingerprint(api)).isEqualTo(discountBefore);
            assertThat(fingerprints(api)).isEqualTo(unrelatedBefore);
            ApiAssertions.assertOmits("captured output", output.getAll(), sentinels);
        }
    }

    private static Map<String, Object> snapshotValues(EffectivePrice value) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("productId", value.productId());
        result.put("sellingPrice", value.sellingPrice().toString());
        result.put("mrp", value.mrp() == null ? null : value.mrp().toString());
        result.put("price", value.price().toString());
        result.put("saving", value.saving().toPlainString());
        result.put("discountId", value.discountId());
        result.put("discountTarget", value.discountTarget());
        result.put("discountKind", value.discountKind());
        result.put("discountValue", value.discountValue() == null ? null : value.discountValue().toPlainString());
        result.put("pricedOn", value.pricedOn());
        return result;
    }

    private static String discountFingerprint(DiscountTestApi api) throws Exception {
        return api.database().single("SELECT coalesce(md5(string_agg(row_value, '|' ORDER BY row_value)), '') FROM "
                + "(SELECT t::text AS row_value FROM discounts t UNION ALL SELECT t::text FROM discount_changes t) rows",
                String.class);
    }

    private static Map<String, String> fingerprints(DiscountTestApi api) throws Exception {
        var tables = api.database().query("SELECT table_name FROM information_schema.tables WHERE table_schema = ? "
                + "AND table_type = 'BASE TABLE' AND table_name NOT IN "
                + "('discounts','discount_changes','user_sessions','user_session_refresh_tokens') "
                + "AND table_name NOT LIKE 'databasechangelog%' ORDER BY table_name",
                row -> row.getString(1), api.database().schema());
        Map<String, String> result = new TreeMap<>();
        for (String table : tables) {
            String quoted = "\"" + table.replace("\"", "\"\"") + "\"";
            result.put(table, api.database().single("SELECT count(*)::text || ':' || "
                    + "coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') FROM " + quoted + " t", String.class));
        }
        return result;
    }
}
