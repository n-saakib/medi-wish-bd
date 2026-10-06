package bd.mediwish.auth;

import bd.mediwish.testsupport.TestDatabase;
import bd.mediwish.testsupport.TestApplication;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
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
import java.util.List;
import java.util.UUID;
import java.util.Map;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Upgrades real fixture data and proves the commit-time exactly-one-role invariant. */
@Tag("integration")
@Tag("regression")
class StaffRoleMigrationIT {
    private static final String REFRESH = "staff-role-migration-refresh-synthetic";
    private static final String VERIFIER = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8()
            .encode("Staff-Role-Migration-Synthetic-Password-1");
    @Test void existingUsersKeepTheirHighestRoleWithoutChangingBootstrapSessionsOrAudit() throws Exception {
        try (var db = TestDatabase.create()) {
            migrate(db, true);
            var roles = List.of(List.of("CUSTOMER"), List.of("CUSTOMER","DELIVERY_PERSON"),
                    List.of("CUSTOMER","MODERATOR","DELIVERY_PERSON"), List.of("DELIVERY_PERSON","MODERATOR"),
                    List.of("CUSTOMER","ADMIN"), List.of("CUSTOMER","MODERATOR","ADMIN"), List.<String>of());
            var expected = List.of("CUSTOMER","DELIVERY_PERSON","MODERATOR","MODERATOR","ADMIN","ADMIN","CUSTOMER");
            var ids = new java.util.ArrayList<UUID>();
            for (int i=0;i<roles.size();i++) {
                UUID id = insertUser(db, "upgrade_role_"+i);
                ids.add(id);
                for (var role:roles.get(i)) db.update("INSERT INTO user_roles(user_id,role) VALUES (?,?)",id,role);
            }
            UUID owner=ids.get(4), session=UUID.randomUUID(), factor=UUID.randomUUID();
            db.update("INSERT INTO staff_bootstrap(id,super_admin_user_id,provisioned_at) VALUES (1,?,now())",owner);
            db.update("INSERT INTO staff_mfa_factors(id,user_id,status,secret_ciphertext,secret_nonce,created_at,activated_at) "
                    +"VALUES (?,?,'ACTIVE','\\x00','\\x00',now(),now())",factor,owner);
            db.update("INSERT INTO user_sessions(id,user_id,created_at,expires_at,last_used_at,mfa_factor_id,mfa_verified_at) "
                    +"VALUES (?,?,now(),now()+interval '30 days',now(),?,now())",session,owner,factor);
            db.update("INSERT INTO user_session_refresh_tokens(id,session_id,generation,token_hash,issued_at,expires_at) "
                    +"VALUES (?,?,0,?,now(),now()+interval '30 days')",UUID.randomUUID(),session,
                    RefreshTokenHasher.hash(REFRESH));
            migrate(db,false);
            for(int i=0;i<ids.size();i++) {
                assertThat(db.query("SELECT role FROM user_roles WHERE user_id=?",row->row.getString(1),ids.get(i)))
                        .containsExactly(expected.get(i));
                assertThat(db.single("SELECT roles_version FROM users WHERE id=?",Long.class,ids.get(i))).isZero();
            }
            assertThat(db.single("SELECT count(*) FROM user_role_changes",Long.class)).isZero();
            assertThat(db.single("SELECT super_admin_user_id FROM staff_bootstrap WHERE id=1",UUID.class)).isEqualTo(owner);
            assertThat(db.single("SELECT revoked_at IS NULL AND mfa_factor_id=? FROM user_sessions WHERE id=?",
                    Boolean.class,factor,session)).isTrue();
            assertThat(db.single("SELECT count(*) FROM user_session_refresh_tokens WHERE session_id=?",Long.class,session)).isOne();
            try (var app = TestApplication.start(db.applicationProperties())) {
                String csrf = (String) json(app.send("GET", "/api/auth/csrf", Map.of(), null)).get("csrfToken");
                var refreshed = app.send("POST", "/api/auth/refresh", Map.of(
                        "Cookie", "MW_REFRESH=" + REFRESH + "; XSRF-TOKEN=" + csrf,
                        "X-XSRF-TOKEN", csrf, "Origin", AuthApi.ALLOWED_ORIGIN), null);
                assertThat(refreshed.statusCode()).isEqualTo(200);
                assertThat(json(refreshed)).containsEntry("mfa", "VERIFIED");
                String accessToken = (String) json(refreshed).get("accessToken");
                app.restart();
                var profile = app.send("GET", "/api/staff/me", Map.of("Authorization", "Bearer " + accessToken), null);
                assertThat(profile.statusCode()).isEqualTo(200);
                assertThat(json(profile)).containsEntry("roles", List.of("ADMIN")).containsEntry("superAdmin", true);
            }
        }
    }
    @Test void anUnknownRoleStopsTheMigrationWithoutChangingExistingData() throws Exception {
        try(var db=TestDatabase.create()) {
            migrate(db,true);
            UUID id=insertUser(db,"unknown_role");
            db.update("INSERT INTO user_roles(user_id,role) VALUES (?,'UNKNOWN')",id);
            assertThatThrownBy(()->migrate(db,false)).hasMessageContaining("011-staff-role-changes");
            assertThat(db.single("SELECT role FROM user_roles WHERE user_id=?",String.class,id)).isEqualTo("UNKNOWN");
            assertThat(db.single("SELECT count(*) FROM information_schema.columns WHERE table_schema=? "
                    +"AND table_name='users' AND column_name='roles_version'",Long.class,db.schema())).isZero();
        }
    }
    @Test void everyCommittedUserHasOneRoleIncludingAfterDeletingAndRekeying() throws Exception {
        try(var db=TestDatabase.create()) {
            migrate(db,false);
            assertThatThrownBy(()->transaction(db, "INSERT INTO users(id,username,mobile,password_hash,mobile_verified,created_at) "
                    +"VALUES ('"+UUID.randomUUID()+"','no_role','01700009001','synthetic',false,now())"))
                    .isInstanceOf(SQLException.class).hasMessageContaining("user_role_required");
            UUID id=UUID.randomUUID();
            transaction(db, "INSERT INTO users(id,username,mobile,password_hash,mobile_verified,created_at) "
                    +"VALUES ('"+id+"','one_role','01700009002','synthetic',false,now())",
                    "INSERT INTO user_roles(user_id,role) VALUES ('"+id+"','CUSTOMER')");
            assertThatThrownBy(()->transaction(db,"DELETE FROM user_roles WHERE user_id='"+id+"'"))
                    .isInstanceOf(SQLException.class).hasMessageContaining("user_role_required");
            assertThatThrownBy(()->transaction(db,"DELETE FROM user_roles WHERE user_id='"+id+"'",
                    "UPDATE users SET id='"+UUID.randomUUID()+"' WHERE id='"+id+"'"))
                    .isInstanceOf(SQLException.class).hasMessageContaining("user_role_required");
            assertThatThrownBy(()->transaction(db,"UPDATE users SET id='"+UUID.randomUUID()+"' WHERE id='"+id+"'"))
                    .isInstanceOf(SQLException.class).hasMessageNotContaining("user_role_required");
            transaction(db,"DELETE FROM user_roles WHERE user_id='"+id+"'",
                    "INSERT INTO user_roles(user_id,role) VALUES ('"+id+"','MODERATOR')");
            assertThatThrownBy(()->db.update("INSERT INTO user_roles(user_id,role) VALUES (?,'ADMIN')",id))
                    .isInstanceOf(SQLException.class);
            assertThatThrownBy(()->db.update("UPDATE user_roles SET role='UNKNOWN' WHERE user_id=?",id))
                    .isInstanceOf(SQLException.class).hasMessageContaining("ck_user_roles_role");
            db.update("DELETE FROM users WHERE id=?",id);
            assertThat(db.single("SELECT count(*) FROM user_roles WHERE user_id=?",Long.class,id)).isZero();
        }
    }
    private static UUID insertUser(TestDatabase db,String name) throws SQLException {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO users(id,username,mobile,password_hash,mobile_verified,created_at) VALUES (?,?,?,?,false,now())",
                id,name,"017"+id.toString().substring(0,8),VERIFIER);
        return id;
    }
    private static void transaction(TestDatabase db,String... sql) throws SQLException {
        try(var connection=db.connect()) {
            connection.setAutoCommit(false);
            try(var statement=connection.createStatement()) { for(var command:sql) statement.execute(command); }
            connection.commit();
        }
    }
    /** Counts all changesets preceding reserved 011, irrespective of later tickets or include files. */
    private static void migrate(TestDatabase db,boolean before) throws Exception {
        try(var resources=new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader());
            Connection connection=db.connect()) {
            var database=DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(connection));
            database.setDefaultSchemaName(db.schema()); database.setLiquibaseSchemaName(db.schema());
            var migration=new Liquibase("db/changelog/db.changelog-master.yaml",resources,database);
            if(before) {
                var changes=migration.getDatabaseChangeLog().getChangeSets();
                int index=0;
                while(index<changes.size() && !changes.get(index).getId().equals("011-staff-role-changes")) index++;
                assertThat(index).as("reserved migration 011 exists").isLessThan(changes.size());
                migration.update(index,new Contexts(),new LabelExpression());
            } else migration.update(new Contexts(),new LabelExpression());
        }
    }
}
