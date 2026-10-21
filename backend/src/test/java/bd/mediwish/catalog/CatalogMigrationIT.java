package bd.mediwish.catalog;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestDatabase;
import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Upgrades an occupied pre-catalog schema, then proves the new PostgreSQL guards. */
@Tag("integration")
@Tag("regression")
class CatalogMigrationIT {
    private static final String CHANGELOG = "db/changelog/db.changelog-master.yaml";

    @Test
    void occupiedPreCatalogSchemaUpgradesWithoutChangingExistingSessionsAndRejectsInvalidRows() throws Exception {
        try (var database = TestDatabase.create()) {
            migrate(database, true);
            UUID userId = UUID.randomUUID();
            UUID sessionId = UUID.randomUUID();
            String username = "cat_mig_" + UUID.randomUUID().toString().substring(0, 8);
            String password = "Synthetic-Migration-Password-1";
            seedExistingIdentity(database, userId, sessionId, username, password);
            String userBefore = database.single("SELECT to_jsonb(u)::text FROM users u WHERE id = ?",
                    String.class, userId);
            String sessionBefore = database.single("SELECT (to_jsonb(s) - 'mfa_replacing_factor_id')::text FROM user_sessions s WHERE id = ?",
                    String.class, sessionId);

            migrate(database, false);
            assertThat(database.single("SELECT to_jsonb(u)::text FROM users u WHERE id = ?", String.class, userId))
                    .as("the existing User is unchanged by catalog migration").isEqualTo(userBefore);
            assertThat(database.single("SELECT (to_jsonb(s) - 'mfa_replacing_factor_id')::text FROM user_sessions s WHERE id = ?",
                    String.class, sessionId))
                    .as("the existing session is unchanged by catalog migration").isEqualTo(sessionBefore);
            assertThat(database.single("SELECT mfa_replacing_factor_id IS NULL FROM user_sessions WHERE id = ?",
                    Boolean.class, sessionId)).as("the new recovery binding defaults to null").isTrue();
            for (String table : new String[] {"product_categories", "products", "product_changes"}) {
                assertThat(database.single("SELECT count(*) FROM " + table, Long.class)).as(table).isZero();
            }
            try (var app = TestApplication.start(database.applicationProperties())) {
                var login = app.send("POST", "/api/auth/login", Map.of("Content-Type", "application/json"),
                        "{\"identifier\":\"" + username + "\",\"password\":\"" + password + "\"}");
                assertThat(login.statusCode()).isEqualTo(200);
                assertThat(json(login)).containsEntry("mfa", "NOT_REQUIRED");
            }

            UUID categoryId = UUID.randomUUID();
            UUID productId = UUID.randomUUID();
            database.update("INSERT INTO product_categories (id, name, created_at, updated_at) "
                    + "VALUES (?, 'Migration category', now(), now())", categoryId);
            database.update("INSERT INTO products (id, kind, name, generic_name, dosage_form, sale_unit, "
                    + "category_id, created_at, updated_at) VALUES (?, 'MEDICINE', 'Synthetic migration medicine', "
                    + "'Synthetic generic', 'Tablet', 'Strip', ?, now(), now())", productId, categoryId);
            assertCheck(database, "UPDATE products SET kind = 'UNKNOWN' WHERE id = ?", "ck_products_kind", productId);
            assertCheck(database, "UPDATE products SET generic_name = NULL WHERE id = ?",
                    "ck_products_medicine_fields", productId);
            assertCheck(database, "UPDATE products SET kind = 'EQUIPMENT' WHERE id = ?",
                    "ck_products_equipment_fields", productId);
            assertCheck(database, "UPDATE products SET selling_price = -1 WHERE id = ?",
                    "ck_products_selling_price_positive", productId);
            // This row also violates price <= MRP; inspect the independent positive-MRP guard directly.
            assertThat(database.single("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    + "WHERE conname = 'ck_products_mrp_positive' AND connamespace = ?::regnamespace",
                    String.class, database.schema())).contains("mrp >");
            assertRejected(database, "UPDATE products SET selling_price = 1.00, mrp = 0 WHERE id = ?", productId);
            assertCheck(database, "UPDATE products SET selling_price = 2.01, mrp = 2.00 WHERE id = ?",
                    "ck_products_price_le_mrp", productId);
            assertCheck(database, "UPDATE products SET active = true WHERE id = ?",
                    "ck_products_active_priced", productId);
            assertCheck(database, "UPDATE products SET mrp = 1.00 WHERE id = ?",
                    "ck_products_mrp_needs_price", productId);
            assertCheck(database, "INSERT INTO product_changes (id, product_id, occurred_at, change_type) "
                    + "VALUES (?, ?, now(), 'UNKNOWN')", "ck_product_changes_type", UUID.randomUUID(), productId);
            assertCheck(database, "UPDATE products SET selling_price = 'NaN', active = true WHERE id = ?",
                    "ck_products_selling_price_finite", productId);
            assertCheck(database, "UPDATE products SET selling_price = 1.00, mrp = 'NaN' WHERE id = ?",
                    "ck_products_mrp_finite", productId);
            assertThat(database.update("UPDATE products SET selling_price = 9999999.99, mrp = 9999999.99 "
                    + "WHERE id = ?", productId)).isOne();
            assertThat(database.single("SELECT selling_price FROM products WHERE id = ?",
                    BigDecimal.class, productId)).isEqualByComparingTo("9999999.99");
            assertThat(database.single("SELECT active FROM products WHERE id = ?", Boolean.class, productId)).isFalse();
        }
    }

    private static void seedExistingIdentity(TestDatabase database, UUID userId, UUID sessionId,
            String username, String password) throws SQLException {
        // Ticket 08's deferred exactly-one-role constraint checks this transaction at commit.
        try (Connection connection = database.connect()) {
            connection.setAutoCommit(false);
            try {
                try (PreparedStatement insert = connection.prepareStatement("INSERT INTO users "
                        + "(id, username, mobile, email, password_hash, mobile_verified, created_at) "
                        + "VALUES (?, ?, '01700008888', NULL, ?, FALSE, now())")) {
                    insert.setObject(1, userId);
                    insert.setString(2, username);
                    insert.setString(3, Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(password));
                    assertThat(insert.executeUpdate()).isOne();
                }
                try (PreparedStatement role = connection.prepareStatement(
                        "INSERT INTO user_roles (user_id, role) VALUES (?, 'CUSTOMER')")) {
                    role.setObject(1, userId);
                    assertThat(role.executeUpdate()).isOne();
                }
                try (PreparedStatement session = connection.prepareStatement("INSERT INTO user_sessions "
                        + "(id, user_id, created_at, expires_at, last_used_at) "
                        + "VALUES (?, ?, now(), now() + interval '30 days', now())")) {
                    session.setObject(1, sessionId);
                    session.setObject(2, userId);
                    assertThat(session.executeUpdate()).isOne();
                }
                connection.commit();
            } catch (SQLException | RuntimeException failure) {
                connection.rollback();
                throw failure;
            }
        }
    }

    /** Finds the pre-013 position in the parsed changelog, rather than hardcoding a changeset count. */
    private static void migrate(TestDatabase database, boolean preCatalog) throws Exception {
        try (var resources = new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader());
             Connection connection = database.connect()) {
            var liquibaseDatabase = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));
            liquibaseDatabase.setDefaultSchemaName(database.schema());
            liquibaseDatabase.setLiquibaseSchemaName(database.schema());
            var liquibase = new Liquibase(CHANGELOG, resources, liquibaseDatabase);
            int catalogPosition = -1;
            var changesets = liquibase.getDatabaseChangeLog().getChangeSets();
            for (int index = 0; index < changesets.size(); index++) {
                if ("013-catalog".equals(changesets.get(index).getId())) {
                    catalogPosition = index;
                    break;
                }
            }
            assertThat(catalogPosition).as("013-catalog must exist exactly once after the old schema").isPositive();
            assertThat(changesets.stream().filter(change -> "013-catalog".equals(change.getId()))).hasSize(1);
            if (preCatalog) liquibase.update(catalogPosition, new Contexts(), new LabelExpression());
            else liquibase.update(new Contexts(), new LabelExpression());
        }
    }

    private static void assertCheck(TestDatabase database, String sql, String constraint, Object... parameters) {
        assertThatThrownBy(() -> database.update(sql, parameters)).isInstanceOf(SQLException.class)
                .satisfies(error -> {
                    SQLException failure = (SQLException) error;
                    assertThat(failure.getSQLState()).isEqualTo("23514");
                    assertThat(failure.getMessage()).contains(constraint);
                });
    }

    private static void assertRejected(TestDatabase database, String sql, Object... parameters) {
        assertThatThrownBy(() -> database.update(sql, parameters)).isInstanceOf(SQLException.class)
                .satisfies(error -> assertThat(((SQLException) error).getSQLState()).isEqualTo("23514"));
    }
}
