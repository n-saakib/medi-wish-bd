package bd.mediwish.user;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestDatabase;
import liquibase.*;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.*;

/** Fresh installation and populated upgrade preserve identities and enforce the pending-change schema. */
@Tag("integration")
@Tag("regression")
class ProfileMigrationIT {
    @Test
    void anUpgradeFromImmediatelyBefore012PreservesExistingRowsAndSetsOnlyProfileDefaults() throws Exception {
        try (var database = TestDatabase.create()) {
            migrate(database, true);
            UUID id = UUID.randomUUID();
            String password = "Migration-Profile-Password-1";
            String passwordHash = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(password);
            database.update("INSERT INTO users(id,username,mobile,email,password_hash,mobile_verified,created_at) "
                    + "VALUES(?, 'legacy.profile', '+8801700001234', 'Legacy@Example.Test', ?, true, now())", id, passwordHash);
            database.update("INSERT INTO user_roles(user_id,role) VALUES(?, 'CUSTOMER')", id);
            UUID sessionId = UUID.randomUUID();
            UUID refreshId = UUID.randomUUID();
            String refreshToken = "migration-profile-refresh-synthetic-00000000";
            database.update("INSERT INTO user_sessions(id,user_id,created_at,expires_at,last_used_at) "
                    + "VALUES(?, ?, now(), now() + interval '30 days', now())", sessionId, id);
            database.update("INSERT INTO user_session_refresh_tokens(id,session_id,generation,token_hash,issued_at,expires_at) "
                    + "VALUES(?, ?, 0, encode(sha256(convert_to(?, 'UTF8')), 'hex'), now(), now() + interval '30 days')",
                    refreshId, sessionId, refreshToken);
            String previousSession = database.single("SELECT s::text FROM user_sessions s WHERE id = ?", String.class, sessionId);
            String previousRefresh = database.single("SELECT t::text FROM user_session_refresh_tokens t WHERE id = ?", String.class, refreshId);
            migrate(database, false);
            assertThat(database.single("SELECT password_hash FROM users WHERE id = ?", String.class, id)).isEqualTo(passwordHash);
            assertThat(database.single("SELECT s::text FROM user_sessions s WHERE id = ?", String.class, sessionId)).isEqualTo(previousSession);
            assertThat(database.single("SELECT t::text FROM user_session_refresh_tokens t WHERE id = ?", String.class, refreshId)).isEqualTo(previousRefresh);
            assertThat(database.single("SELECT username FROM users WHERE id = ?", String.class, id)).isEqualTo("legacy.profile");
            assertThat(database.single("SELECT mobile FROM users WHERE id = ?", String.class, id)).isEqualTo("+8801700001234");
            assertThat(database.single("SELECT email FROM users WHERE id = ?", String.class, id)).isEqualTo("Legacy@Example.Test");
            assertThat(database.single("SELECT mobile_verified FROM users WHERE id = ?", Boolean.class, id)).isTrue();
            assertThat(database.single("SELECT account_state FROM users WHERE id = ?", String.class, id)).isEqualTo("ACTIVE");
            assertThat(database.single("SELECT profile_version FROM users WHERE id = ?", Long.class, id)).isZero();
            assertThat(database.single("SELECT full_name FROM users WHERE id = ?", String.class, id)).isNull();
            assertThat(database.single("SELECT date_of_birth::text FROM users WHERE id = ?", String.class, id)).isNull();
            assertThat(database.single("SELECT role FROM user_roles WHERE user_id = ?", String.class, id)).isEqualTo("CUSTOMER");
            constraints(database, id);
            try (var app = TestApplication.start(database.applicationProperties())) {
                assertThat(app.bean(ProfileService.class).profile(id).username()).isEqualTo("legacy.profile");
                var stableProfile = Map.<String, Object>of("username", "legacy.profile", "mobile", "+8801700001234",
                        "email", "Legacy@Example.Test", "mobileVerified", true);
                var csrf = app.send("GET", "/api/auth/csrf", Map.of(), null);
                assertThat(csrf.statusCode()).isEqualTo(200);
                String csrfToken = (String) json(csrf).get("csrfToken");
                var renewed = app.send("POST", "/api/auth/refresh", Map.of(
                        "Cookie", "MW_REFRESH=" + refreshToken + "; XSRF-TOKEN=" + csrfToken,
                        "X-XSRF-TOKEN", csrfToken, "Origin", "http://127.0.0.1:3000"), null);
                assertThat(renewed.statusCode()).isEqualTo(200);
                assertThat(json(renewed)).containsEntry("mfa", "NOT_REQUIRED").containsEntry("user", stableProfile);
                String existingToken = (String) json(renewed).get("accessToken");
                assertStableProfile(app, existingToken, stableProfile);
                assertThat(database.single("SELECT consumed_at IS NOT NULL FROM user_session_refresh_tokens WHERE id = ?",
                        Boolean.class, refreshId)).isTrue();
                assertThat(database.single("SELECT count(*) FROM user_session_refresh_tokens WHERE session_id = ?",
                        Long.class, sessionId)).isEqualTo(2);
                assertThat(database.single("SELECT revoked_at FROM user_sessions WHERE id = ?", java.time.OffsetDateTime.class,
                        sessionId)).isNull();

                var login = app.send("POST", "/api/auth/login", Map.of("Content-Type", "application/json"),
                        "{\"identifier\":\"legacy.profile\",\"password\":\"" + password + "\"}");
                assertThat(login.statusCode()).isEqualTo(200);
                assertThat(json(login)).containsEntry("mfa", "NOT_REQUIRED").containsEntry("user", stableProfile);
                assertStableProfile(app, (String) json(login).get("accessToken"), stableProfile);
            }
        }
    }

    @Test
    void theEntireChangelogAlsoInstallsAndValidatesOnAnEmptyDatabase() throws Exception {
        try (var database = TestDatabase.create(); var app = TestApplication.start(database.applicationProperties())) {
            UUID id = UUID.randomUUID();
            database.update("INSERT INTO users(id,username,mobile,password_hash,mobile_verified,created_at) "
                    + "VALUES(?, 'fresh.profile', '01700000000', 'synthetic-verifier', false, now())", id);
            constraints(database, id);
            assertThat(app.bean(ProfileService.class).profile(id).version()).isZero();
        }
    }

    private static void assertStableProfile(TestApplication app, String accessToken, Map<String, Object> expected) throws Exception {
        var response = app.send("GET", "/api/user/me", Map.of("Authorization", "Bearer " + accessToken), null);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json(response)).isEqualTo(expected);
    }

    private static void constraints(TestDatabase database, UUID id) throws Exception {
        assertThatThrownBy(() -> database.update("UPDATE users SET account_state = 'UNKNOWN' WHERE id = ?", id))
                .isInstanceOf(SQLException.class).satisfies(e -> assertThat(((SQLException)e).getSQLState()).isEqualTo("23514"));
        assertThatThrownBy(() -> database.update("UPDATE users SET profile_version = null WHERE id = ?", id))
                .isInstanceOf(SQLException.class).satisfies(e -> assertThat(((SQLException)e).getSQLState()).isEqualTo("23502"));
        database.update("UPDATE users SET account_state = 'CLOSURE_REQUESTED' WHERE id = ?", id);
        database.update("UPDATE users SET account_state = 'ACTIVE' WHERE id = ?", id);
        UUID pending = UUID.randomUUID();
        database.update("INSERT INTO user_mobile_changes(id,user_id,new_mobile,requested_at) VALUES(?, ?, '01800000000', now())",
                pending, id);
        assertThatThrownBy(() -> database.update("INSERT INTO user_mobile_changes(id,user_id,new_mobile,requested_at) "
                + "VALUES(?, ?, '01900000000', now())", UUID.randomUUID(), id))
                .isInstanceOf(SQLException.class).satisfies(e -> assertThat(((SQLException)e).getSQLState()).isEqualTo("23505"));
        assertThatThrownBy(() -> database.update("INSERT INTO user_mobile_changes(id,user_id,new_mobile,requested_at) "
                + "VALUES(?, ?, '01800000000', now())", UUID.randomUUID(), UUID.randomUUID()))
                .isInstanceOf(SQLException.class).satisfies(e -> assertThat(((SQLException)e).getSQLState()).isEqualTo("23503"));
        assertThatThrownBy(() -> database.update("UPDATE user_mobile_changes SET new_mobile = '018000000000' WHERE id = ?", pending))
                .isInstanceOf(SQLException.class).satisfies(e -> assertThat(((SQLException)e).getSQLState()).isEqualTo("22001"));
        database.update("DELETE FROM user_mobile_changes WHERE user_id = ?", id);
        UUID disposable = UUID.randomUUID();
        database.update("INSERT INTO users(id,username,mobile,password_hash,mobile_verified,created_at) "
                + "VALUES(?, ?, '01900000000', 'synthetic-verifier', false, now())", disposable, "cascade_" + disposable);
        database.update("INSERT INTO user_mobile_changes(id,user_id,new_mobile,requested_at) VALUES(?, ?, '01800000000', now())",
                UUID.randomUUID(), disposable);
        database.update("DELETE FROM users WHERE id = ?", disposable);
        assertThat(database.single("SELECT count(*) FROM user_mobile_changes WHERE user_id = ?", Long.class, disposable)).isZero();
    }

    private static void migrate(TestDatabase database, boolean stopBeforeProfile) throws Exception {
        try (var resources = new ClassLoaderResourceAccessor(); var connection = database.connect()) {
            var target = DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(connection));
            target.setDefaultSchemaName(database.schema());
            target.setLiquibaseSchemaName(database.schema());
            try (var migrations = new Liquibase("db/changelog/db.changelog-master.yaml", resources, target)) {
                if (stopBeforeProfile) {
                    var changes = migrations.getDatabaseChangeLog().getChangeSets();
                    int index = 0;
                    while (index < changes.size() && !changes.get(index).getId().equals("012-user-profile")) index++;
                    assertThat(index).as("012 exists in numeric position").isLessThan(changes.size());
                    migrations.update(index, new Contexts(), new LabelExpression());
                } else migrations.update(new Contexts(), new LabelExpression());
            }
        }
    }
}
