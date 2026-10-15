package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Anonymous price projection crosses the real transaction boundary without admitting hidden products. */
@Tag("integration")
@Tag("security")
class PublicPriceIT {
    @Test
    void anonymousPriceUsesTheSameDiscountAndIgnoresEvenInvalidBearerCredentials() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "150.00");
            api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "15", TODAY, null);
            String path = "/api/products/" + product.get("id") + "/price";
            var anonymous = api.send("GET", path, null, null);
            assertThat(anonymous.statusCode()).isEqualTo(200);
            var value = json(anonymous);
            var expected = new LinkedHashMap<String, Object>(Map.of("productId", product.get("id"),
                    "sellingPrice", "150.00", "price", "127.50", "saving", "22.50",
                    "discount", Map.of("targetType", "PRODUCT", "kind", "PERCENTAGE", "value", "15")));
            expected.put("mrp", null);
            assertThat(value).containsExactlyInAnyOrderEntriesOf(expected);
            var authenticated = api.send("GET", path, admin, null);
            var invalidBearer = api.application().send("GET", path, Map.of("Authorization", "Bearer invalid"), null);
            assertThat(authenticated.statusCode()).isEqualTo(200);
            assertThat(invalidBearer.statusCode()).isEqualTo(200);
            assertThat(json(authenticated)).isEqualTo(value);
            assertThat(json(invalidBearer)).isEqualTo(value);
        }
    }

    @Test
    void unknownInactiveUnpricedAndMalformedIdsAreIndistinguishableBoundedNotFoundResponses() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID category = id(api.category(admin));
            var unpriced = api.product(admin, category);
            var inactive = api.price(admin, api.product(admin, category), "100.00");
            for (Object productId : List.of(UUID.randomUUID(), inactive.get("id"), unpriced.get("id"), "not-a-uuid")) {
                assertError(api.send("GET", "/api/products/" + productId + "/price", null, null), 404, "NOT_FOUND");
            }
        }
    }
}
