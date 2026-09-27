package bd.mediwish.auth;

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

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Changeset 010 on a database that already has a signed-in customer (Ticket 06, T6). */
@Tag("integration")
@Tag("regression")
class StaffMfaMigrationIT {
    private static final int CHANGESETS_BEFORE_STAFF_MFA = 9;
    private static final String REFRESH_TOKEN = "migration-refresh-token-synthetic-000000000";

    @Test
    void anExistingCustomerSessionSurvivesAndTheNewConstraintsHold() throws Exception {
        try (var database = TestDatabase.create()) {
            update(database, CHANGESETS_BEFORE_STAFF_MFA);
            UUID userId = UUID.randomUUID();
            UUID sessionId = UUID.randomUUID();
            database.update("INSERT INTO users (id, username, mobile, email, password_hash, mobile_verified, "
                    + "created_at) VALUES (?, 'migration_customer', '01700009999', NULL, ?, FALSE, now())", userId,
                    Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode("Migration-Only-Password-1"));
            database.update("INSERT INTO user_roles (user_id, role) VALUES (?, 'CUSTOMER')", userId);
            database.update("INSERT INTO user_sessions (id, user_id, created_at, expires_at, last_used_at) "
                    + "VALUES (?, ?, now(), now() + interval '30 days', now())", sessionId, userId);
            database.update("INSERT INTO user_session_refresh_tokens (id, session_id, generation, token_hash, "
                    + "issued_at, expires_at) VALUES (?, ?, 0, ?, now(), now() + interval '30 days')",
                    UUID.randomUUID(), sessionId, RefreshTokenHasher.hash(REFRESH_TOKEN));

            try (var app = TestApplication.start(database.applicationProperties())) {
                var csrf = app.send("GET", "/api/auth/csrf", Map.of(), null);
                String token = (String) json(csrf).get("csrfToken");
                var response = app.send("POST", "/api/auth/refresh", Map.of(
                        "Cookie", "MW_REFRESH=" + REFRESH_TOKEN + "; XSRF-TOKEN=" + token,
                        "X-XSRF-TOKEN", token, "Origin", AuthApi.ALLOWED_ORIGIN), null);
                assertThat(response.statusCode()).isEqualTo(200);
                assertThat(json(response)).containsEntry("mfa", "NOT_REQUIRED");
            }
            assertThat(database.single("SELECT mfa_factor_id IS NULL AND mfa_verified_at IS NULL FROM user_sessions "
                    + "WHERE id = ?", Boolean.class, sessionId)).isTrue();

            database.update("INSERT INTO staff_mfa_factors (id, user_id, status, secret_ciphertext, secret_nonce, "
                    + "created_at, activated_at) VALUES (?, ?, 'ACTIVE', '\\x00', '\\x00', now(), now())",
                    UUID.randomUUID(), userId);
            assertRejected(database, "INSERT INTO staff_mfa_factors (id, user_id, status, secret_ciphertext, "
                    + "secret_nonce, created_at) VALUES ('" + UUID.randomUUID() + "', '" + userId
                    + "', 'ACTIVE', '\\x00', '\\x00', now())");
            database.update("INSERT INTO staff_mfa_factors (id, user_id, status, secret_ciphertext, secret_nonce, "
                    + "created_at, pending_expires_at) VALUES (?, ?, 'PENDING', '\\x00', '\\x00', now(), now())",
                    UUID.randomUUID(), userId);
            assertRejected(database, "INSERT INTO staff_mfa_factors (id, user_id, status, secret_ciphertext, "
                    + "secret_nonce, created_at, pending_expires_at) VALUES ('" + UUID.randomUUID() + "', '"
                    + userId + "', 'PENDING', '\\x00', '\\x00', now(), now())");
            assertRejected(database, "INSERT INTO staff_mfa_factors (id, user_id, status, secret_ciphertext, "
                    + "secret_nonce, created_at) VALUES ('" + UUID.randomUUID() + "', '" + userId
                    + "', 'UNKNOWN', '\\x00', '\\x00', now())");
            assertRejected(database, "INSERT INTO staff_bootstrap (id, super_admin_user_id, provisioned_at) "
                    + "VALUES (2, NULL, now())");
            database.update("INSERT INTO staff_bootstrap (id, super_admin_user_id, provisioned_at) "
                    + "VALUES (1, ?, now())", userId);
            assertRejected(database, "INSERT INTO staff_bootstrap (id, super_admin_user_id, provisioned_at) "
                    + "VALUES (1, NULL, now())");
        }
    }

    private static void assertRejected(TestDatabase database, String sql) {
        assertThatThrownBy(() -> database.update(sql)).as(sql).isInstanceOf(SQLException.class);
    }

    /** Applies the first {@code count} changesets of the master changelog directly, without the application. */
    private static void update(TestDatabase database, int count) throws Exception {
        try (var resources = new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader());
             Connection connection = database.connect()) {
            var liquibaseDatabase = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));
            liquibaseDatabase.setDefaultSchemaName(database.schema());
            liquibaseDatabase.setLiquibaseSchemaName(database.schema());
            new Liquibase("db/changelog/db.changelog-master.yaml", resources, liquibaseDatabase)
                    .update(count, new Contexts(), new LabelExpression());
        }
    }
}
