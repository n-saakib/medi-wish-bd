package bd.mediwish.address;
import bd.mediwish.testsupport.TestDatabase;
import liquibase.*;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.*;
import java.sql.SQLException;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

@Tag("integration") @Tag("migration")
class AddressMigrationIT {
    @Test void anUpgradeFromImmediatelyBefore017KeepsUsersAndCreatesAnEmptyBook() throws Exception {
        try(var database=TestDatabase.create()) {
            migrate(database,true); UUID user=user(database,"01700000001"); UUID session=UUID.randomUUID();
            database.update("INSERT INTO user_sessions(id,user_id,created_at,expires_at,last_used_at) VALUES(?,?,now(),now()+interval '30 days',now())",session,user);
            String beforeUser=database.single("SELECT u::text FROM users u WHERE id=?",String.class,user);
            String beforeSession=database.single("SELECT (to_jsonb(s) - 'mfa_replacing_factor_id')::text FROM user_sessions s WHERE id=?",String.class,session);
            migrate(database,false);
            assertThat(database.single("SELECT u::text FROM users u WHERE id=?",String.class,user)).isEqualTo(beforeUser);
            assertThat(database.single("SELECT (to_jsonb(s) - 'mfa_replacing_factor_id')::text FROM user_sessions s WHERE id=?",String.class,session)).isEqualTo(beforeSession);
            assertThat(database.single("SELECT mfa_replacing_factor_id IS NULL FROM user_sessions WHERE id=?",Boolean.class,session)).isTrue();
            assertThat(database.single("SELECT count(*) FROM saved_addresses",Long.class)).isZero();
            assertThat(database.single("SELECT count(*) FROM saved_address_changes",Long.class)).isZero();
        }
    }
    @Test void theEntireChangelogInstallsOnAnEmptyDatabase() throws Exception {
        try(var database=TestDatabase.create()) {
            migrate(database,false);
            assertThat(database.single("SELECT count(*) FROM databasechangelog WHERE id='017-saved-addresses'",Long.class)).isOne();
            assertThat(database.single("SELECT count(*) FROM saved_addresses",Long.class)).isZero();
            assertThat(database.single("SELECT count(*) FROM saved_address_changes",Long.class)).isZero();
        }
    }
    @Test void constraintsRefuseInvalidRows() throws Exception {
        try(var database=TestDatabase.create()) {
            migrate(database,false); UUID a=user(database,"01700000001"), b=user(database,"01700000002"), id=UUID.randomUUID();
            insert(database,a,id,true); insert(database,b,id,true);
            failure(() -> insert(database,a,UUID.randomUUID(),true),"23505","uq_saved_addresses_default");
            failure(() -> insert(database,a,id,false),"23505","pk_saved_addresses");
            for(String assignment:new String[]{"mobile='0170000000'","recipient_name=' '","address_line=' '","city=' '","version=-1"})
                failure(() -> database.update("UPDATE saved_addresses SET "+assignment+" WHERE user_id=? AND id=?",a,id),"23514",null);
            failure(() -> database.update("UPDATE saved_addresses SET label=? WHERE user_id=? AND id=?","x".repeat(41),a,id),"22001",null);
            failure(() -> database.update("INSERT INTO saved_address_changes(id,changed_at) VALUES(?,now())",UUID.randomUUID()),"23502",null);
            failure(() -> database.update("INSERT INTO saved_address_changes(id,user_id) VALUES(?,?)",UUID.randomUUID(),a),"23502",null);
            failure(() -> insert(database,UUID.randomUUID(),UUID.randomUUID(),false),"23503",null);
            database.update("INSERT INTO saved_address_changes(id,user_id,changed_at) VALUES(?,?,now())",UUID.randomUUID(),a);
            database.update("DELETE FROM users WHERE id=?",a);
            assertThat(database.single("SELECT count(*) FROM saved_addresses WHERE user_id=?",Long.class,a)).isZero();
            assertThat(database.single("SELECT count(*) FROM saved_address_changes WHERE user_id=?",Long.class,a)).isZero();
            assertThat(database.single("SELECT count(*) FROM saved_addresses WHERE user_id=?",Long.class,b)).isOne();
        }
    }
    private static UUID user(TestDatabase database,String mobile) throws Exception {
        UUID id=UUID.randomUUID();
        database.update("WITH u AS (INSERT INTO users(id,username,mobile,password_hash,mobile_verified,created_at) VALUES(?,?,?,'synthetic-verifier',false,now()) RETURNING id) INSERT INTO user_roles(user_id,role) SELECT id,'CUSTOMER' FROM u",id,"migration_"+id,mobile); return id;
    }
    private static void insert(TestDatabase db,UUID user,UUID id,boolean isDefault) throws SQLException {
        db.update("INSERT INTO saved_addresses(user_id,id,recipient_name,mobile,address_line,city,is_default,created_at,updated_at) VALUES(?,?,'Synthetic Recipient','01700000000','Synthetic Road','Synthetic City',?,now(),now())",user,id,isDefault);
    }
    private static void failure(org.assertj.core.api.ThrowableAssert.ThrowingCallable action,String state,String constraint) {
        assertThatThrownBy(action).isInstanceOf(SQLException.class).satisfies(e -> {
            assertThat(((SQLException)e).getSQLState()).isEqualTo(state);
            if(constraint!=null)assertThat(e.getMessage()).contains(constraint);
        });
    }
    private static void migrate(TestDatabase database,boolean stop) throws Exception {
        try(var resources=new ClassLoaderResourceAccessor();var connection=database.connect()) {
            var target=DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(connection));
            target.setDefaultSchemaName(database.schema()); target.setLiquibaseSchemaName(database.schema());
            try(var migrations=new Liquibase("db/changelog/db.changelog-master.yaml",resources,target)) {
                if(stop) {
                    var changes=migrations.getDatabaseChangeLog().getChangeSets(); int index=0;
                    while(index<changes.size()&&!changes.get(index).getId().equals("017-saved-addresses"))index++;
                    assertThat(index).isLessThan(changes.size()); migrations.update(index,new Contexts(),new LabelExpression());
                } else migrations.update(new Contexts(),new LabelExpression());
            }
        }
    }
}
