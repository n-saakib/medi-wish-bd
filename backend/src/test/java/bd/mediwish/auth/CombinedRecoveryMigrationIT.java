package bd.mediwish.auth;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestDatabase;
import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import liquibase.resource.DirectoryResourceAccessor;
import liquibase.resource.ResourceAccessor;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** A standalone Ticket 05 database has 019 applied before it ever sees 018. */
@Tag("integration") @Tag("migration") @Tag("regression")
class CombinedRecoveryMigrationIT {
    private static final String CHANGELOG = "db/changelog/db.changelog-master.yaml";

    @Test
    void anAlreadyApplied019KeepsItsChecksumAndRowsWhen018Arrives(@TempDir Path historicalRoot) throws Exception {
        String current;
        try (var input = getClass().getClassLoader().getResourceAsStream(CHANGELOG)) {
            assertThat(input).isNotNull();
            current = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
        int staff = current.lastIndexOf("  - changeSet:", current.indexOf("id: 018-staff-mfa-recovery"));
        int email = current.lastIndexOf("  - changeSet:", current.indexOf("id: 019-account-email-recovery"));
        assertThat(staff).isPositive().isLessThan(email);
        int next = current.indexOf("  - changeSet:", email + 1);
        // Retain the original paths and bodies through 017 and 019; future changesets are not part of this fixture.
        String historical = current.substring(0, staff) + current.substring(email, next < 0 ? current.length() : next);
        Path fixture = historicalRoot.resolve(CHANGELOG);
        Files.createDirectories(fixture.getParent());
        Files.writeString(fixture, historical, StandardCharsets.UTF_8);

        try (var database = TestDatabase.create()) {
            try (var resources = new DirectoryResourceAccessor(historicalRoot)) { migrate(database, resources); }
            assertThat(database.single("SELECT count(*) FROM databasechangelog WHERE id='018-staff-mfa-recovery'", Long.class)).isZero();
            String checksum = database.single("SELECT md5sum FROM databasechangelog WHERE id='019-account-email-recovery'", String.class);
            UUID user = UUID.randomUUID(), session = UUID.randomUUID(), code = UUID.randomUUID();
            database.update("WITH u AS (INSERT INTO users(id,username,mobile,email,email_verified_at,password_hash,mobile_verified,created_at) "
                    + "VALUES(?,'historical_email_user','01700007654','historical@example.test',now(),'synthetic-verifier',false,now()) RETURNING id) "
                    + "INSERT INTO user_roles(user_id,role) SELECT id,'CUSTOMER' FROM u", user);
            database.update("INSERT INTO user_sessions(id,user_id,created_at,last_used_at,expires_at) VALUES(?,?,now(),now(),now()+interval '1 day')", session, user);
            database.update("INSERT INTO account_codes(id,user_id,purpose,code_hash,sent_to,created_at,expires_at) "
                    + "VALUES(?,?,'PASSWORD_RESET',?,'historical@example.test',now(),now()+interval '15 minutes')", code, user, "a".repeat(64));
            String beforeUser = database.single("SELECT to_jsonb(u)::text FROM users u WHERE id=?", String.class, user);
            String beforeSession = database.single("SELECT to_jsonb(s)::text FROM user_sessions s WHERE id=?", String.class, session);
            String beforeCode = database.single("SELECT to_jsonb(c)::text FROM account_codes c WHERE id=?", String.class, code);

            try (var resources = new ClassLoaderResourceAccessor()) { migrate(database, resources); }
            assertRetained(database, user, session, code, checksum, beforeUser, beforeSession, beforeCode);
            try (var app = TestApplication.start(database.applicationProperties())) {
                app.restart();
                assertRetained(database, user, session, code, checksum, beforeUser, beforeSession, beforeCode);
            }
        }
    }

    private static void assertRetained(TestDatabase database, UUID user, UUID session, UUID code, String checksum,
                                       String beforeUser, String beforeSession, String beforeCode) throws Exception {
        assertThat(database.single("SELECT count(*) FROM databasechangelog WHERE id='018-staff-mfa-recovery'", Long.class)).isOne();
        assertThat(database.single("SELECT md5sum FROM databasechangelog WHERE id='019-account-email-recovery'", String.class)).isEqualTo(checksum);
        assertThat(database.single("SELECT to_jsonb(u)::text FROM users u WHERE id=?", String.class, user)).isEqualTo(beforeUser);
        assertThat(database.single("SELECT (to_jsonb(s)-'mfa_replacing_factor_id')::text FROM user_sessions s WHERE id=?", String.class, session)).isEqualTo(beforeSession);
        assertThat(database.single("SELECT mfa_replacing_factor_id IS NULL FROM user_sessions WHERE id=?", Boolean.class, session)).isTrue();
        assertThat(database.single("SELECT to_jsonb(c)::text FROM account_codes c WHERE id=?", String.class, code)).isEqualTo(beforeCode);
    }

    private static void migrate(TestDatabase database, ResourceAccessor resources) throws Exception {
        try (var connection = database.connect()) {
            var target = DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(connection));
            target.setDefaultSchemaName(database.schema());
            target.setLiquibaseSchemaName(database.schema());
            try (var migration = new Liquibase(CHANGELOG, resources, target)) {
                migration.update(new Contexts(), new LabelExpression());
            }
        }
    }
}
