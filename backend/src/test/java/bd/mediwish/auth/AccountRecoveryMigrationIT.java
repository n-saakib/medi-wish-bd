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

/** Changeset 019 upgrades a populated pre-recovery schema without disturbing existing account security state. */
@Tag("integration")
@Tag("regression")
class AccountRecoveryMigrationIT {
    private static final String RECOVERY_CHANGESET = "019-account-email-recovery";
    private static final String USERNAME = "legacy_recovery_admin";
    private static final String EMAIL = "Legacy.Recovery@Example.Test";
    private static final String PASSWORD = "Migration-Recovery-Password-1";
    private static final String REFRESH_TOKEN = "migration-recovery-refresh-synthetic-00000000";
    private static final String ALLOWED_ORIGIN = "http://127.0.0.1:3000";

    @Test
    void upgradeFromBeforeRecoveryPreservesTheExistingUserSessionAndMfa() throws Exception {
        try (var database = TestDatabase.create()) {
            migrate(database, true);

            UUID userId = UUID.randomUUID();
            UUID factorId = UUID.randomUUID();
            UUID backupCodeId = UUID.randomUUID();
            UUID sessionId = UUID.randomUUID();
            UUID refreshId = UUID.randomUUID();
            String passwordHash = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(PASSWORD);

            // The role insert shares the statement so the deferred required-role trigger sees a valid User at commit.
            database.update("WITH inserted AS (INSERT INTO users (id, username, mobile, email, password_hash, "
                            + "mobile_verified, created_at) VALUES (?, ?, '01700001234', ?, ?, TRUE, now()) "
                            + "RETURNING id) "
                            + "INSERT INTO user_roles (user_id, role) SELECT id, 'ADMIN' FROM inserted",
                    userId, USERNAME, EMAIL, passwordHash);
            database.update("INSERT INTO staff_mfa_factors (id, user_id, status, secret_ciphertext, secret_nonce, "
                            + "created_at, activated_at) VALUES (?, ?, 'ACTIVE', ?, ?, now(), now())",
                    factorId, userId, new byte[]{0}, new byte[]{0});
            database.update("INSERT INTO staff_mfa_backup_codes (id, factor_id, code_verifier, created_at) "
                            + "VALUES (?, ?, 'synthetic-migration-verifier', now())",
                    backupCodeId, factorId);
            database.update("INSERT INTO user_sessions (id, user_id, created_at, expires_at, last_used_at, "
                            + "mfa_factor_id, mfa_verified_at) VALUES (?, ?, now(), now() + interval '30 days', "
                            + "now(), ?, now())",
                    sessionId, userId, factorId);
            database.update("INSERT INTO user_session_refresh_tokens (id, session_id, generation, token_hash, "
                            + "issued_at, expires_at) VALUES (?, ?, 0, ?, now(), now() + interval '30 days')",
                    refreshId, sessionId, RefreshTokenHasher.hash(REFRESH_TOKEN));

            String existingSession = database.single("SELECT s::text FROM user_sessions s WHERE id = ?",
                    String.class, sessionId);
            String existingRefresh = database.single("SELECT t::text FROM user_session_refresh_tokens t WHERE id = ?",
                    String.class, refreshId);
            String existingFactor = database.single("SELECT f::text FROM staff_mfa_factors f WHERE id = ?",
                    String.class, factorId);
            String existingBackupCode = database.single("SELECT c::text FROM staff_mfa_backup_codes c WHERE id = ?",
                    String.class, backupCodeId);

            migrate(database, false);

            assertThat(database.single("SELECT password_hash FROM users WHERE id = ?", String.class, userId))
                    .isEqualTo(passwordHash);
            assertThat(database.single("SELECT email FROM users WHERE id = ?", String.class, userId)).isEqualTo(EMAIL);
            assertThat(database.single("SELECT email_verified_at IS NULL FROM users WHERE id = ?",
                    Boolean.class, userId))
                    .isTrue();
            assertThat(database.single("SELECT role FROM user_roles WHERE user_id = ?", String.class, userId))
                    .isEqualTo("ADMIN");
            assertThat(database.single("SELECT s::text FROM user_sessions s WHERE id = ?", String.class, sessionId))
                    .isEqualTo(existingSession);
            assertThat(database.single("SELECT t::text FROM user_session_refresh_tokens t WHERE id = ?",
                    String.class, refreshId))
                    .isEqualTo(existingRefresh);
            assertThat(database.single("SELECT f::text FROM staff_mfa_factors f WHERE id = ?", String.class, factorId))
                    .isEqualTo(existingFactor);
            assertThat(database.single("SELECT c::text FROM staff_mfa_backup_codes c WHERE id = ?",
                    String.class, backupCodeId))
                    .isEqualTo(existingBackupCode);
            assertThat(database.single("SELECT count(*) FROM account_codes", Long.class)).isZero();
            assertThat(database.single("SELECT count(*) FROM account_code_limits", Long.class)).isZero();

            assertThatThrownBy(() -> database.update("UPDATE users SET email = NULL, email_verified_at = now() "
                    + "WHERE id = ?", userId))
                    .isInstanceOf(SQLException.class)
                    .satisfies(error -> {
                        SQLException sqlException = (SQLException) error;
                        assertThat(sqlException.getSQLState()).isEqualTo("23514");
                        assertThat(sqlException.getMessage()).contains("ck_users_email_verified_needs_email");
                    });

            try (var app = TestApplication.start(database.applicationProperties())) {
                var login = app.send("POST", "/api/auth/login", Map.of("Content-Type", "application/json"),
                        "{\"identifier\":\"" + USERNAME + "\",\"password\":\"" + PASSWORD + "\"}");
                assertThat(login.statusCode()).isEqualTo(200);
                assertThat(json(login)).containsEntry("mfa", "VERIFICATION_REQUIRED");

                var csrf = app.send("GET", "/api/auth/csrf", Map.of(), null);
                assertThat(csrf.statusCode()).isEqualTo(200);
                String csrfToken = (String) json(csrf).get("csrfToken");
                var refresh = app.send("POST", "/api/auth/refresh", Map.of(
                        "Cookie", "MW_REFRESH=" + REFRESH_TOKEN + "; XSRF-TOKEN=" + csrfToken,
                        "X-XSRF-TOKEN", csrfToken,
                        "Origin", ALLOWED_ORIGIN), null);
                assertThat(refresh.statusCode()).isEqualTo(200);
                assertThat(json(refresh)).containsEntry("mfa", "VERIFIED");

                String accessToken = (String) json(refresh).get("accessToken");
                var profile = app.send("GET", "/api/user/me/profile",
                        Map.of("Authorization", "Bearer " + accessToken), null);
                assertThat(profile.statusCode()).isEqualTo(200);
                assertThat(json(profile)).containsEntry("username", USERNAME)
                        .containsEntry("email", EMAIL)
                        .containsEntry("emailVerified", false);
            }
        }
    }

    /** Applies all changesets before 019 by locating its ID in the master changelog. */
    private static void migrate(TestDatabase database, boolean stopBeforeRecovery) throws Exception {
        try (var resources = new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader());
             Connection connection = database.connect()) {
            var liquibaseDatabase = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));
            liquibaseDatabase.setDefaultSchemaName(database.schema());
            liquibaseDatabase.setLiquibaseSchemaName(database.schema());
            try (var migrations = new Liquibase("db/changelog/db.changelog-master.yaml", resources,
                    liquibaseDatabase)) {
                if (stopBeforeRecovery) {
                    var changes = migrations.getDatabaseChangeLog().getChangeSets();
                    int index = 0;
                    while (index < changes.size() && !changes.get(index).getId().equals(RECOVERY_CHANGESET)) index++;
                    assertThat(index).as("019-account-email-recovery exists in the changelog")
                            .isLessThan(changes.size());
                    migrations.update(index, new Contexts(), new LabelExpression());
                } else {
                    migrations.update(new Contexts(), new LabelExpression());
                }
            }
        }
    }
}
