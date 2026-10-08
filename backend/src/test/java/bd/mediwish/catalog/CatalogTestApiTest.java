package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

/** Protects the catalog integration request mapping and fixture-specific JDBC configuration. */
class CatalogTestApiTest {
    @Test
    void concurrencyTimeoutChangesOnlyTheCopiedApplicationJdbcSocketTimeout() {
        String url = "jdbc:postgresql://127.0.0.1:55432/medi_wish_test"
                + "?currentSchema=mw_it_synthetic&connectTimeout=2&socketTimeout=3";
        Map<String, Object> source = Map.of("spring.datasource.url", url,
                "spring.datasource.username", "synthetic_run_role",
                "spring.liquibase.default-schema", "mw_it_synthetic");

        var adjusted = CatalogTestApi.applicationProperties(source, 15);

        assertThat(adjusted).containsExactlyInAnyOrderEntriesOf(Map.of(
                "spring.datasource.url", url.replace("socketTimeout=3", "socketTimeout=15"),
                "spring.datasource.username", "synthetic_run_role",
                "spring.liquibase.default-schema", "mw_it_synthetic"));
        assertThat(source.get("spring.datasource.url")).isEqualTo(url);
        assertThat(CatalogTestApi.applicationProperties(source, 3)).isEqualTo(source);
    }

    @Test
    void fixtureSocketTimeoutCannotDisableItsDeadline() {
        assertThatIllegalArgumentException().isThrownBy(() -> CatalogTestApi.applicationProperties(
                Map.of("spring.datasource.url", "jdbc:postgresql://synthetic/?socketTimeout=3"), 0));
    }
    @Test
    void catalogBodyKeepsEditableFieldsAndVersionWithoutServerOwnedFields() {
        UUID categoryId = UUID.randomUUID();
        Map<String, Object> product = new LinkedHashMap<>();
        product.put("id", UUID.randomUUID());
        product.put("kind", "MEDICINE");
        product.put("name", "Original medicine");
        product.put("brandName", "Original brand");
        product.put("genericName", "Synthetic generic");
        product.put("manufacturer", null);
        product.put("dosageForm", "Tablet");
        product.put("saleUnit", "Strip");
        product.put("description", null);
        product.put("categoryId", categoryId);
        product.put("requireValidation", false);
        product.put("active", false);
        product.put("version", 3);
        product.put("sellingPrice", "11.50");
        product.put("mrp", "12.00");
        product.put("history", java.util.List.of(Map.of("changeType", "CREATED")));
        product.put("updatedAt", "2026-10-05T00:00:00Z");
        product.put("updatedByUsername", "synthetic_admin");
        product.put("status", "INACTIVE");

        Map<String, Object> expected = new LinkedHashMap<>();
        expected.put("name", "Edited medicine");
        expected.put("brandName", "Original brand");
        expected.put("genericName", "Synthetic generic");
        expected.put("manufacturer", null);
        expected.put("dosageForm", "Tablet");
        expected.put("saleUnit", "Strip");
        expected.put("description", null);
        expected.put("categoryId", categoryId);
        expected.put("requireValidation", false);
        expected.put("active", true);
        expected.put("version", 3);

        assertThat(CatalogTestApi.catalogBody(product, Map.of("name", "Edited medicine", "active", true)))
                .isEqualTo(expected);
    }
}
