package bd.mediwish.catalog;

import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Measures real HTTP query costs, including current-role/MFA authentication, on an isolated synthetic catalog. */
@Tag("integration")
class CatalogQueriesIT {
    @Test
    void categoryAndHistoryQueriesRemainBoundedAsPagesAndHistoryGrow() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            var categories = new ArrayList<UUID>();
            for (int i = 0; i < 5; i++) {
                categories.add(UUID.fromString((String) api.category(admin, "Query category " + i).get("id")));
            }
            Map<String, Object> first = null;
            for (int i = 0; i < 60; i++) {
                // Stable ordering makes the small page touch one category and the larger page all five.
                var draft = CatalogTestApi.draft("EQUIPMENT", categories.get(i < 5 ? 0 : 1 + (i - 5) % 4));
                draft.put("name", "Query product %02d".formatted(i));
                var created = api.createProduct(admin, draft);
                if (first == null) first = created;
            }
            var statistics = api.application().bean(EntityManagerFactory.class)
                    .unwrap(SessionFactory.class).getStatistics();
            statistics.setStatisticsEnabled(true);
            api.send("GET", "/api/staff/products?size=5", admin, null);
            statistics.clear();
            var small = api.send("GET", "/api/staff/products?size=5", admin, null);
            long smallCount = statistics.getPrepareStatementCount();
            assertThat(small.statusCode()).isEqualTo(200);
            assertThat(json(small).get("totalItems")).isEqualTo(60);
            assertThat(json(small).get("items")).asList().hasSize(5)
                    .extracting(item -> String.valueOf(((Map<?, ?>) item).get("categoryId")))
                    .containsOnly(categories.getFirst().toString());
            statistics.clear();
            var page = api.send("GET", "/api/staff/products?size=20", admin, null);
            long pageCount = statistics.getPrepareStatementCount();
            assertThat(page.statusCode()).isEqualTo(200);
            assertThat(json(page).get("items")).asList().hasSize(20)
                    .extracting(item -> String.valueOf(((Map<?, ?>) item).get("categoryId")))
                    .contains(categories.stream().map(UUID::toString).toArray(String[]::new));
            assertThat(pageCount).isPositive().isLessThanOrEqualTo(16L).isLessThanOrEqualTo(smallCount + 1);
            statistics.clear();
            api.get(admin, first.get("id"));
            long shortHistoryCount = statistics.getPrepareStatementCount();
            for (int i = 0; i < 22; i++) first = api.edit(admin, first, Map.of("requireValidation", i % 2 == 0));
            // Distinct actors prevent a first-level User cache from hiding history-username N+1 queries.
            api.database().update("""
                    WITH actors AS (
                        INSERT INTO users (id, username, mobile, email, password_hash, mobile_verified, created_at)
                        SELECT gen_random_uuid(), 'query_actor_' || n, '019' || lpad(n::text, 8, '0'), NULL,
                            u.password_hash, false, now() FROM users u CROSS JOIN generate_series(1,20) n
                            WHERE u.id = ? RETURNING id)
                    INSERT INTO user_roles (user_id, role) SELECT id, 'MODERATOR' FROM actors
                    """, admin.userId());
            api.database().update("""
                    INSERT INTO product_changes (id, product_id, occurred_at, actor_user_id, change_type,
                        old_require_validation, new_require_validation)
                    SELECT gen_random_uuid(), ?, now() + row_number() OVER (ORDER BY username) * interval '1 microsecond',
                        id, 'CATALOG_UPDATED', false, false FROM users WHERE username LIKE 'query_actor_%'
                    """, UUID.fromString((String) first.get("id")));
            statistics.clear();
            var detailed = api.get(admin, first.get("id"));
            long fullHistoryCount = statistics.getPrepareStatementCount();
            assertThat(detailed.get("history")).asList().hasSize(20);
            assertThat(fullHistoryCount).isLessThanOrEqualTo(18L).isLessThanOrEqualTo(shortHistoryCount + 1);
            statistics.clear();
            first = api.price(admin, first, "11.50", "12.00");
            long pricingCount = statistics.getPrepareStatementCount();
            assertThat(first).containsEntry("sellingPrice", "11.50");
            assertThat(pricingCount).isLessThanOrEqualTo(24L);
            statistics.clear();
            var categoryPage = api.send("GET", "/api/staff/categories?size=50", admin, null);
            long categoriesCount = statistics.getPrepareStatementCount();
            assertThat(categoryPage.statusCode()).isEqualTo(200);
            assertThat(categoriesCount).isPositive().isLessThanOrEqualTo(16L);
            statistics.clear();
            api.category(admin, "Measured new category");
            long categoryCreateCount = statistics.getPrepareStatementCount();
            assertThat(categoryCreateCount).isPositive().isLessThanOrEqualTo(16L);
            statistics.clear();
            var categoryUpdate = api.send("PUT", "/api/staff/categories/" + categories.getFirst(), admin,
                    Map.of("name", "Measured renamed category", "active", true, "version", 0));
            long categoryUpdateCount = statistics.getPrepareStatementCount();
            assertThat(categoryUpdate.statusCode()).isEqualTo(200);
            assertThat(categoryUpdateCount).isPositive().isLessThanOrEqualTo(16L);
            statistics.clear();
            api.equipment(admin, categories.getFirst());
            long productCreateCount = statistics.getPrepareStatementCount();
            assertThat(productCreateCount).isPositive().isLessThanOrEqualTo(24L);
            statistics.clear();
            first = api.edit(admin, first, Map.of("name", "Measured catalog update"));
            long catalogUpdateCount = statistics.getPrepareStatementCount();
            assertThat(first).containsEntry("name", "Measured catalog update");
            assertThat(catalogUpdateCount).isPositive().isLessThanOrEqualTo(24L);
            System.out.printf("Catalog query counts: page5=%d page20=%d detail1=%d detail20=%d pricing=%d "
                            + "categories=%d categoryCreate=%d categoryUpdate=%d productCreate=%d catalogUpdate=%d%n",
                    smallCount, pageCount, shortHistoryCount, fullHistoryCount, pricingCount, categoriesCount,
                    categoryCreateCount, categoryUpdateCount, productCreateCount, catalogUpdateCount);
        }
    }

    @Test
    void recordsTheInformationalListPlanForOneThousandSyntheticProducts() throws Exception {
        try (var api = CatalogTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID categoryId = UUID.fromString((String) api.category(admin, "Explain category").get("id"));
            api.database().update("""
                    INSERT INTO products (id, kind, name, sale_unit, category_id, active, require_validation,
                        version, created_at, updated_at)
                    SELECT gen_random_uuid(), 'EQUIPMENT', 'Synthetic measurement ' || n, '1 piece', ?,
                        false, false, 0, now(), now() FROM generate_series(1,1000) n
                    """, categoryId);
            assertThat(api.database().single("SELECT count(*) FROM products", Long.class)).isEqualTo(1000L);
            api.database().update("ANALYZE products");
            var plan = api.database().query("""
                    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
                    SELECT p.*, c.* FROM products p JOIN product_categories c ON c.id = p.category_id
                    WHERE p.category_id = ? AND (lower(p.name) LIKE ? ESCAPE '!'
                        OR lower(coalesce(p.brand_name, '')) LIKE ? ESCAPE '!' OR lower(coalesce(p.generic_name, '')) LIKE ? ESCAPE '!')
                    ORDER BY lower(p.name), p.id LIMIT 20
                    """, row -> row.getString(1), categoryId, "%measurement%", "%measurement%", "%measurement%");
            assertThat(plan).isNotEmpty();
            System.out.println("Catalog informational EXPLAIN (1000 synthetic products, no SLA claim):");
            plan.forEach(System.out::println);
        }
    }
}
