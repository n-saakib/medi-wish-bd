package bd.mediwish.auth;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestAuthSettings;
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

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Upgrade populated Ticket 06 staff MFA rows through changeset 018. */
@Tag("integration")
@Tag("migration")
@Tag("regression")
class StaffMfaRecoveryMigrationIT {
    private static final String CHANGELOG = "db/changelog/db.changelog-master.yaml";
    private static final int CHANGESETS_BEFORE_018 = changesetsBeforeRecovery();
    private static final String VERIFIED_REFRESH = "migration-verified-refresh-synthetic-0000000";
    private static final String RESTRICTED_REFRESH = "migration-restricted-refresh-synthetic-00000";

    @Test
    void existingStaffSessionsAndBackupCodesSurviveTheUpgradeAndRecoveryConstraintsHold() throws Exception {
        try (var database = TestDatabase.create()) {
            update(database, CHANGESETS_BEFORE_018);
            assertThat(database.single("SELECT count(*) FROM databasechangelog WHERE id = '018-staff-mfa-recovery'",
                    Long.class)).isZero();
            UUID userId = UUID.randomUUID();
            UUID factorId = UUID.randomUUID();
            UUID verifiedSession = UUID.randomUUID();
            UUID restrictedSession = UUID.randomUUID();
            UUID firstCode = UUID.randomUUID();
            UUID secondCode = UUID.randomUUID();
            var passwords = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
            insertStaffUser(database, userId, passwords.encode("Migration-Only-Password-2"));
            var sealed = new MfaSecretCipher(TestAuthSettings.properties(), new SecureRandom())
                    .encrypt(factorId, "01234567890123456789".getBytes(StandardCharsets.US_ASCII));
            database.update("INSERT INTO staff_mfa_factors (id, user_id, status, secret_ciphertext, secret_nonce, "
                    + "created_at, activated_at) VALUES (?, ?, 'ACTIVE', ?, ?, now(), now())", factorId, userId,
                    sealed.ciphertext(), sealed.nonce());
            insertCode(database, firstCode, factorId, passwords.encode("ABCD2345"));
            insertCode(database, secondCode, factorId, passwords.encode("EFGH6789"));
            insertSession(database, verifiedSession, userId, factorId, VERIFIED_REFRESH);
            insertSession(database, restrictedSession, userId, null, RESTRICTED_REFRESH);
            try (var app = TestApplication.start(database.applicationProperties())) {
                assertThat(database.single("SELECT count(*) FROM databasechangelog "
                        + "WHERE id = '018-staff-mfa-recovery'", Long.class)).isOne();
                assertThat(database.single("SELECT count(*) FROM user_sessions WHERE user_id = ? "
                        + "AND mfa_replacing_factor_id IS NULL", Long.class, userId)).isEqualTo(2);
                assertThat(database.single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id = ? "
                        + "AND consumed_at IS NULL AND consumed_session_id IS NULL", Long.class, factorId)).isEqualTo(2);
                assertThat(database.single("SELECT status FROM staff_mfa_factors WHERE id = ?", String.class,
                        factorId)).isEqualTo("ACTIVE");
                String verifiedAccess = refreshedAccess(app, VERIFIED_REFRESH, "VERIFIED");
                assertThat(app.send("GET", "/api/staff/me", bearer(verifiedAccess), null).statusCode()).isEqualTo(200);
                String restrictedAccess = refreshedAccess(app, RESTRICTED_REFRESH, "VERIFICATION_REQUIRED");
                var refused = app.send("GET", "/api/staff/me", bearer(restrictedAccess), null);
                assertThat(refused.statusCode()).isEqualTo(403);
                assertThat(json(refused)).containsEntry("code", "MFA_REQUIRED");
                redeem(app, restrictedAccess, "ABCD-2345");
                assertThat(database.single("SELECT consumed_at IS NOT NULL AND consumed_session_id = ? "
                        + "FROM staff_mfa_backup_codes WHERE id = ?", Boolean.class, restrictedSession, firstCode)).isTrue();
                var login = app.send("POST", "/api/auth/login", Map.of("Content-Type", "application/json"),
                        "{\"identifier\":\"migration_staff_recovery\",\"password\":\"Migration-Only-Password-2\"}");
                assertThat(login.statusCode()).isEqualTo(200);
                assertThat(json(login)).containsEntry("mfa", "VERIFICATION_REQUIRED");
                redeem(app, (String) json(login).get("accessToken"), "EFGH-6789");
                assertThat(database.single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id = ? "
                        + "AND consumed_at IS NOT NULL AND consumed_session_id IS NOT NULL", Long.class, factorId))
                        .isEqualTo(2);
            }
            assertRejected(database, "UPDATE user_sessions SET mfa_replacing_factor_id = '" + factorId
                    + "' WHERE id = '" + verifiedSession + "'", "23514");
            assertRejected(database, "UPDATE staff_mfa_backup_codes SET consumed_session_id = NULL WHERE id = '"
                    + firstCode + "'", "23514");
            assertRejected(database, "UPDATE staff_mfa_backup_codes SET consumed_at = NULL WHERE id = '"
                    + firstCode + "'", "23514");
            assertRejected(database, "UPDATE user_sessions SET mfa_replacing_factor_id = '" + UUID.randomUUID()
                    + "' WHERE id = '" + restrictedSession + "'", "23503");
            assertThat(database.single("SELECT count(*) FROM user_sessions WHERE user_id = ? "
                    + "AND mfa_replacing_factor_id = ?", Long.class, userId, factorId)).isEqualTo(2);
            long sessionsBeforeDelete = database.single("SELECT count(*) FROM user_sessions WHERE user_id = ?",
                    Long.class, userId);
            database.update("DELETE FROM staff_mfa_factors WHERE id = ?", factorId);
            assertThat(database.single("SELECT count(*) FROM user_sessions WHERE user_id = ? "
                    + "AND mfa_replacing_factor_id IS NULL", Long.class, userId)).isEqualTo(sessionsBeforeDelete);
            assertThat(database.single("SELECT count(*) FROM staff_mfa_backup_codes WHERE factor_id = ?",
                    Long.class, factorId)).isZero();
        }
    }

    /** The pre-018 role-required trigger checks at commit, after both rows have been inserted. */
    private static void insertStaffUser(TestDatabase database, UUID userId, String passwordHash) throws SQLException {
        try (var connection = database.connect()) {
            connection.setAutoCommit(false);
            try {
                try (var user = connection.prepareStatement("INSERT INTO users "
                        + "(id, username, mobile, password_hash, mobile_verified, created_at) "
                        + "VALUES (?, 'migration_staff_recovery', '01700009998', ?, FALSE, now())");
                     var role = connection.prepareStatement("INSERT INTO user_roles (user_id, role) "
                             + "VALUES (?, 'MODERATOR')")) {
                    user.setObject(1, userId);
                    user.setString(2, passwordHash);
                    user.executeUpdate();
                    role.setObject(1, userId);
                    role.executeUpdate();
                }
                connection.commit();
            } catch (SQLException exception) {
                connection.rollback();
                throw exception;
            }
        }
    }

    private static void insertCode(TestDatabase database, UUID id, UUID factorId, String verifier) throws SQLException {
        database.update("INSERT INTO staff_mfa_backup_codes (id, factor_id, code_verifier, created_at) "
                + "VALUES (?, ?, ?, now())", id, factorId, verifier);
    }

    private static void insertSession(TestDatabase database, UUID id, UUID userId, UUID factorId, String refresh)
            throws SQLException {
        boolean verified = factorId != null;
        database.update("INSERT INTO user_sessions (id, user_id, created_at, expires_at, last_used_at, "
                + "mfa_factor_id, mfa_verified_at) VALUES (?, ?, now(), now() + interval '"
                + (verified ? "30 days" : "10 minutes") + "', now(), ?, " + (verified ? "now()" : "NULL") + ")",
                id, userId, factorId);
        database.update("INSERT INTO user_session_refresh_tokens (id, session_id, generation, token_hash, "
                + "issued_at, expires_at) SELECT ?, id, 0, ?, now(), expires_at FROM user_sessions WHERE id = ?",
                UUID.randomUUID(), RefreshTokenHasher.hash(refresh), id);
    }

    private static String refreshedAccess(TestApplication app, String refresh, String assurance) throws Exception {
        String token = (String) json(app.send("GET", "/api/auth/csrf", Map.of(), null)).get("csrfToken");
        var response = app.send("POST", "/api/auth/refresh", Map.of("Cookie", "MW_REFRESH=" + refresh
                + "; XSRF-TOKEN=" + token, "X-XSRF-TOKEN", token, "Origin", AuthApi.ALLOWED_ORIGIN), null);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json(response)).containsEntry("mfa", assurance);
        return (String) json(response).get("accessToken");
    }

    private static void redeem(TestApplication app, String access, String code) throws Exception {
        var response = app.send("POST", "/api/auth/mfa/recovery", Map.of("Authorization", "Bearer " + access,
                "Content-Type", "application/json"), "{\"backupCode\":\"" + code + "\"}");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json(response)).containsEntry("mfa", "REPLACEMENT_REQUIRED");
    }

    private static Map<String, String> bearer(String access) {
        return Map.of("Authorization", "Bearer " + access);
    }

    private static void assertRejected(TestDatabase database, String sql, String sqlState) {
        assertThatThrownBy(() -> database.update(sql)).isInstanceOfSatisfying(SQLException.class,
                exception -> assertThat(exception.getSQLState()).isEqualTo(sqlState));
    }

    private static int changesetsBeforeRecovery() {
        try (var input = StaffMfaRecoveryMigrationIT.class.getClassLoader().getResourceAsStream(CHANGELOG)) {
            if (input == null) throw new IllegalStateException("Master changelog missing");
            try (var reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                int changesets = 0;
                for (String line; (line = reader.readLine()) != null;) {
                    if (line.matches("\\s*- changeSet:\\s*")) changesets++;
                    if (line.trim().equals("id: 018-staff-mfa-recovery")) {
                        if (changesets < 2) throw new IllegalStateException("Recovery upgrade needs a populated baseline");
                        return changesets - 1;
                    }
                }
                throw new IllegalStateException("Recovery changeset missing");
            }
        } catch (java.io.IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        }
    }

    private static void update(TestDatabase database, int count) throws Exception {
        try (var resources = new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader());
             Connection connection = database.connect()) {
            var liquibaseDatabase = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));
            liquibaseDatabase.setDefaultSchemaName(database.schema());
            liquibaseDatabase.setLiquibaseSchemaName(database.schema());
            new Liquibase(CHANGELOG, resources, liquibaseDatabase)
                    .update(count, new Contexts(), new LabelExpression());
        }
    }
}
