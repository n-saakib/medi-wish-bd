package bd.mediwish.catalog;

import bd.mediwish.testsupport.TestDatabase;
import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Real empty-schema and occupied-schema migrations; every probe uses the guarded run-owned database. */
@Tag("integration")
@Tag("regression")
class DiscountMigrationIT {
    private static final String CHANGELOG = "db/changelog/db.changelog-master.yaml";

    @Test
    void emptySchemaHasDiscountTablesIndexesAndExactDecimalStorage() throws Exception {
        try (var database = TestDatabase.create()) {
            migrate(database, false);
            for (String table : new String[] {"discounts", "discount_changes"}) {
                assertThat(database.single("SELECT count(*) FROM " + table, Long.class)).isZero();
            }
            for (String index : new String[] {"ix_discounts_product", "ix_discounts_category",
                    "ix_discounts_starts", "ix_discount_changes_discount"}) {
                assertThat(database.single("SELECT count(*) FROM pg_indexes WHERE schemaname = ? AND indexname = ?",
                        Long.class, database.schema(), index)).as(index).isOne();
            }
            for (String table : new String[] {"discounts", "discount_changes"}) {
                assertThat(database.single("SELECT numeric_precision || ',' || numeric_scale "
                        + "FROM information_schema.columns WHERE table_schema = ? AND table_name = ? "
                        + "AND column_name = 'amount'", String.class, database.schema(), table)).isEqualTo("9,2");
                assertThat(database.single("SELECT numeric_precision || ',' || numeric_scale "
                        + "FROM information_schema.columns WHERE table_schema = ? AND table_name = ? "
                        + "AND column_name = 'percent'", String.class, database.schema(), table)).isEqualTo("4,2");
            }
        }
    }

    @Test
    void upgradeRetainsProductsAndDatabaseRefusesInvalidDiscountsAndDeletion() throws Exception {
        try (var database = TestDatabase.create()) {
            migrate(database, true);
            UUID category = UUID.randomUUID();
            UUID priced = UUID.randomUUID();
            UUID unpriced = UUID.randomUUID();
            UUID categoryWithoutProducts = UUID.randomUUID();
            database.update("INSERT INTO product_categories (id,name,created_at,updated_at) "
                    + "VALUES (?, 'Discount migration category', now(), now()), "
                    + "(?, 'Discount migration empty category', now(), now())", category, categoryWithoutProducts);
            database.update("INSERT INTO products (id,kind,name,sale_unit,category_id,selling_price,mrp,active,"
                    + "version,created_at,updated_at) VALUES (?, 'EQUIPMENT', 'Migration priced', '1 piece', ?, "
                    + "123.45, 150.00, TRUE, 7, now(), now()), "
                    + "(?, 'EQUIPMENT', 'Migration unpriced', '1 piece', ?, NULL, NULL, FALSE, 3, now(), now())",
                    priced, category, unpriced, category);
            String pricedBefore = productRow(database, priced);
            String unpricedBefore = productRow(database, unpriced);
            migrate(database, false);
            assertThat(productRow(database, priced)).isEqualTo(pricedBefore);
            assertThat(productRow(database, unpriced)).isEqualTo(unpricedBefore);

            UUID discount = UUID.randomUUID();
            database.update("INSERT INTO discounts (id,target_type,product_id,kind,percent,starts_on,created_at,updated_at) "
                    + "VALUES (?, 'PRODUCT', ?, 'PERCENTAGE', 10, DATE '2026-01-15', now(), now())", discount, priced);
            check(database, "UPDATE discounts SET category_id = ? WHERE id = ?", "ck_discounts_target", category, discount);
            // UNKNOWN also violates the target-shape guard; PostgreSQL may report either check first.
            rejected(database, "UPDATE discounts SET target_type = 'UNKNOWN' WHERE id = ?", "23514", null, discount);
            check(database, "UPDATE discounts SET kind = 'UNKNOWN' WHERE id = ?", "ck_discounts_kind", discount);
            check(database, "UPDATE discounts SET amount = 1 WHERE id = ?", "ck_discounts_value", discount);
            for (int validPercent : new int[] {1, 99}) {
                assertThat(database.update("UPDATE discounts SET percent = ? WHERE id = ?",
                        validPercent, discount)).isOne();
            }
            // In-range fractions isolate integrality from the 1..99 range checks.
            for (String value : new String[] {"0", "1.50", "98.50", "99.50", "'NaN'"}) {
                check(database, "UPDATE discounts SET percent = " + value + " WHERE id = ?",
                        "ck_discounts_percent_range", discount);
            }
            rejected(database, "UPDATE discounts SET percent = 100 WHERE id = ?", "22003", null, discount);
            check(database, "UPDATE discounts SET ends_on = DATE '2026-01-14' WHERE id = ?", "ck_discounts_dates", discount);
            database.update("UPDATE discounts SET kind = 'FLAT', percent = NULL, amount = 0.01 WHERE id = ?", discount);
            for (String value : new String[] {"0", "-0.01", "'NaN'"}) {
                check(database, "UPDATE discounts SET amount = " + value + " WHERE id = ?",
                        "ck_discounts_amount_range", discount);
            }
            database.update("UPDATE discounts SET amount = 9999999.99 WHERE id = ?", discount);
            rejected(database, "UPDATE discounts SET amount = 10000000 WHERE id = ?", "22003", null, discount);
            check(database, "INSERT INTO discount_changes (id,discount_id,occurred_at,change_type,kind,amount,starts_on) "
                    + "VALUES (?, ?, now(), 'DELETED', 'FLAT', 1, DATE '2026-01-15')", "ck_discount_changes_type",
                    UUID.randomUUID(), discount);
            rejected(database, "DELETE FROM products WHERE id = ?", "23001", null, priced);

            // No Product references this Category: its refusal proves the discount FK, not the catalog FK.
            UUID categoryDiscount = UUID.randomUUID();
            database.update("INSERT INTO discounts (id,target_type,category_id,kind,amount,starts_on,created_at,updated_at) "
                    + "VALUES (?, 'CATEGORY', ?, 'FLAT', 1, DATE '2026-01-15', now(), now())",
                    categoryDiscount, categoryWithoutProducts);
            rejected(database, "DELETE FROM product_categories WHERE id = ?", "23001", null, categoryWithoutProducts);
            database.update("DELETE FROM discounts WHERE id = ?", categoryDiscount);
            assertThat(database.update("DELETE FROM product_categories WHERE id = ?", categoryWithoutProducts)).isOne();

            database.update("INSERT INTO discount_changes (id,discount_id,occurred_at,change_type,kind,amount,starts_on) "
                    + "VALUES (?, ?, now(), 'CREATED', 'FLAT', 9999999.99, DATE '2026-01-15')",
                    UUID.randomUUID(), discount);
            rejected(database, "DELETE FROM discounts WHERE id = ?", "23001", null, discount);
            for (String derived : new String[] {"DISCOUNT_STARTED", "DISCOUNT_ENDED"}) {
                check(database, "INSERT INTO product_changes (id,product_id,occurred_at,change_type) VALUES (?, ?, now(), ?)",
                        "ck_product_changes_type", UUID.randomUUID(), priced, derived);
            }
            assertThat(productRow(database, priced)).isEqualTo(pricedBefore);
            assertThat(productRow(database, unpriced)).isEqualTo(unpricedBefore);
        }
    }

    private static String productRow(TestDatabase database, UUID id) throws SQLException {
        return database.single("SELECT to_jsonb(p)::text FROM products p WHERE id = ?", String.class, id);
    }

    private static void migrate(TestDatabase database, boolean beforeDiscounts) throws Exception {
        try (var resources = new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader());
             Connection connection = database.connect()) {
            var target = DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(connection));
            target.setDefaultSchemaName(database.schema());
            target.setLiquibaseSchemaName(database.schema());
            var liquibase = new Liquibase(CHANGELOG, resources, target);
            var changes = liquibase.getDatabaseChangeLog().getChangeSets();
            assertThat(changes.stream().filter(change -> "016-discounts".equals(change.getId()))).hasSize(1);
            int position = -1;
            for (int index = 0; index < changes.size(); index++) {
                if ("016-discounts".equals(changes.get(index).getId())) { position = index; break; }
            }
            assertThat(position).isPositive();
            if (beforeDiscounts) liquibase.update(position, new Contexts(), new LabelExpression());
            else liquibase.update(new Contexts(), new LabelExpression());
        }
    }

    private static void check(TestDatabase database, String sql, String constraint, Object... values) {
        rejected(database, sql, "23514", constraint, values);
    }

    private static void rejected(TestDatabase database, String sql, String state, String constraint, Object... values) {
        assertThatThrownBy(() -> database.update(sql, values)).isInstanceOf(SQLException.class).satisfies(error -> {
            SQLException failure = (SQLException) error;
            assertThat(failure.getSQLState()).isEqualTo(state);
            if (constraint != null) assertThat(failure.getMessage()).contains(constraint);
        });
    }
}
