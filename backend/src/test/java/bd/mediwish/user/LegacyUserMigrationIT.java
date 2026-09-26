package bd.mediwish.user;

import bd.mediwish.MediWishApplication;
import bd.mediwish.health.TestDatabase;
import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
@Tag("regression")
class LegacyUserMigrationIT {
    private static final int LEGACY_CHANGESET_COUNT = 3;
    private static final UUID LEGACY_ID = UUID.fromString("a7cae613-9522-4d9b-8f72-7df2348c637e");
    private static final UUID SECOND_LEGACY_ID = UUID.fromString("3e2b10c6-d81f-41b6-902a-328218effa12");
    private static final UUID MIXED_CASE_LEGACY_ID = UUID.fromString("b4526f9b-bbef-4ea8-900c-34f712b7f97f");
    private static final String LEGACY_USERNAME = "legacy_migration_customer";
    private static final String SECOND_LEGACY_USERNAME = "legacy_migration_customer_two";
    private static final String MIXED_CASE_LEGACY_USERNAME = "legacy_migration_customer_three";
    private static final String LEGACY_MOBILE = "+8801700001234";
    private static final String SECOND_LEGACY_MOBILE = "+8801700001235";
    private static final String MIXED_CASE_LEGACY_MOBILE = "+8801700001236";
    private static final String SHARED_LEGACY_EMAIL = "legacy-customer@example.invalid";
    private static final String MIXED_CASE_LEGACY_EMAIL = "Legacy.Case.Customer@Example.Invalid";
    private static final String LEGACY_PASSWORD = "Legacy-Migration-Only-9!";
    private static final OffsetDateTime LEGACY_CREATED_AT =
            OffsetDateTime.of(2024, 2, 3, 4, 5, 6, 0, ZoneOffset.UTC);
    private static final OffsetDateTime SECOND_LEGACY_CREATED_AT =
            OffsetDateTime.of(2024, 2, 4, 4, 5, 6, 0, ZoneOffset.UTC);
    private static final OffsetDateTime MIXED_CASE_LEGACY_CREATED_AT =
            OffsetDateTime.of(2024, 2, 5, 4, 5, 6, 0, ZoneOffset.UTC);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Argon2PasswordEncoder LEGACY_PASSWORDS =
            Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();

    @Test
    void populatedLegacyCustomersRetainDataRolesAndLoginByUsernameOrMixedCaseEmail() throws Exception {
        try (var database = TestDatabase.create()) {
            applyLegacyChangelog(database);
            assertThat(appliedChangesets(database)).containsExactly(
                    "001-foundation", "002-customers", "003-customer-java-owned-values");

            String passwordHash = LEGACY_PASSWORDS.encode(LEGACY_PASSWORD);
            assertThat(passwordHash).startsWith("$argon2id$v=19$m=16384,t=2,p=1$");
            insertLegacyCustomer(database, LEGACY_ID, LEGACY_USERNAME, LEGACY_MOBILE,
                    SHARED_LEGACY_EMAIL, passwordHash, LEGACY_CREATED_AT);
            insertLegacyCustomer(database, SECOND_LEGACY_ID, SECOND_LEGACY_USERNAME, SECOND_LEGACY_MOBILE,
                    SHARED_LEGACY_EMAIL, passwordHash, SECOND_LEGACY_CREATED_AT);
            insertLegacyCustomer(database, MIXED_CASE_LEGACY_ID,
                    MIXED_CASE_LEGACY_USERNAME, MIXED_CASE_LEGACY_MOBILE,
                    MIXED_CASE_LEGACY_EMAIL, passwordHash, MIXED_CASE_LEGACY_CREATED_AT);

            try (ConfigurableApplicationContext application = startApplication(database);
                 HttpClient client = HttpClient.newBuilder()
                         .connectTimeout(Duration.ofSeconds(2)).build()) {
                assertThat(appliedChangesets(database)).contains(
                        "004-shared-users-and-roles", "005-user-password-sessions", "006-user-email-lookup",
                        "007-user-email-case-insensitive-lookup", "008-drop-unused-exact-email-index");
                assertLegacyUserWasPreserved(
                        database, LEGACY_ID, LEGACY_USERNAME, LEGACY_MOBILE, SHARED_LEGACY_EMAIL,
                        passwordHash, LEGACY_CREATED_AT);
                assertLegacyUserWasPreserved(database, SECOND_LEGACY_ID, SECOND_LEGACY_USERNAME,
                        SECOND_LEGACY_MOBILE, SHARED_LEGACY_EMAIL, passwordHash, SECOND_LEGACY_CREATED_AT);
                assertLegacyUserWasPreserved(database, MIXED_CASE_LEGACY_ID, MIXED_CASE_LEGACY_USERNAME,
                        MIXED_CASE_LEGACY_MOBILE, MIXED_CASE_LEGACY_EMAIL, passwordHash,
                        MIXED_CASE_LEGACY_CREATED_AT);
                assertThat(countUsersWithEmail(database, SHARED_LEGACY_EMAIL)).isEqualTo(2);
                assertThat(countUsersWithEmail(database, MIXED_CASE_LEGACY_EMAIL)).isEqualTo(1);
                assertCustomerRoleWasBackfilled(database, LEGACY_ID);
                assertCustomerRoleWasBackfilled(database, SECOND_LEGACY_ID);
                assertCustomerRoleWasBackfilled(database, MIXED_CASE_LEGACY_ID);
                assertLegacyUserCanAuthenticate(client, application, LEGACY_USERNAME, LEGACY_MOBILE,
                        SHARED_LEGACY_EMAIL, LEGACY_USERNAME);
                assertLegacyUserCanAuthenticate(client, application, SECOND_LEGACY_USERNAME,
                        SECOND_LEGACY_MOBILE, SHARED_LEGACY_EMAIL, SECOND_LEGACY_USERNAME);
                assertLegacyUserCanAuthenticate(client, application, MIXED_CASE_LEGACY_USERNAME,
                        MIXED_CASE_LEGACY_MOBILE, MIXED_CASE_LEGACY_EMAIL,
                        MIXED_CASE_LEGACY_EMAIL.toLowerCase(java.util.Locale.ROOT));
            }
        }
    }

    private static void applyLegacyChangelog(TestDatabase database) throws Exception {
        try (var resources = new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader());
             Connection connection = database.connect()) {
            var liquibaseDatabase = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));
            liquibaseDatabase.setDefaultSchemaName(database.schema());
            liquibaseDatabase.setLiquibaseSchemaName(database.schema());
            var liquibase = new Liquibase(
                    "db/changelog/db.changelog-master.yaml", resources, liquibaseDatabase);
            liquibase.update(LEGACY_CHANGESET_COUNT, new Contexts(), new LabelExpression());
        }
    }

    private static void insertLegacyCustomer(TestDatabase database, UUID id, String username,
                                             String mobile, String email, String passwordHash,
                                             OffsetDateTime createdAt)
            throws SQLException {
        String sql = "INSERT INTO " + quotedSchema(database)
                + ".customers (id, username, mobile, email, password_hash, mobile_verified, created_at)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?)";
        try (Connection connection = database.connect();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, id);
            statement.setString(2, username);
            statement.setString(3, mobile);
            statement.setString(4, email);
            statement.setString(5, passwordHash);
            statement.setBoolean(6, false);
            statement.setObject(7, createdAt);
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private static ConfigurableApplicationContext startApplication(TestDatabase database) {
        Map<String, Object> properties = new HashMap<>(database.applicationProperties());
        properties.put("app.auth.access-token-lifetime", "PT5M");
        var application = new SpringApplication(MediWishApplication.class);
        application.addInitializers(context -> context.getEnvironment().getPropertySources()
                .addFirst(new MapPropertySource("legacy-user-migration-it", properties)));
        return application.run();
    }

    private static void assertLegacyUserWasPreserved(TestDatabase database, UUID id, String username,
                                                     String mobile, String email, String passwordHash,
                                                     OffsetDateTime createdAt) throws SQLException {
        String sql = "SELECT id, username, mobile, email, password_hash, mobile_verified, created_at FROM "
                + quotedSchema(database) + ".users WHERE id = ?";
        try (Connection connection = database.connect();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, id);
            try (var row = statement.executeQuery()) {
                assertThat(row.next()).as("legacy User %s survives the current master changelog", username).isTrue();
                assertThat(row.getObject("id", UUID.class)).isEqualTo(id);
                assertThat(row.getString("username")).isEqualTo(username);
                assertThat(row.getString("mobile")).isEqualTo(mobile);
                assertThat(row.getString("email")).isEqualTo(email);
                assertThat(row.getString("password_hash")).isEqualTo(passwordHash);
                assertThat(row.getBoolean("mobile_verified")).isFalse();
                assertThat(row.getObject("created_at", OffsetDateTime.class)).isEqualTo(createdAt);
                assertThat(row.next()).as("there is exactly one row for the legacy identifier").isFalse();
            }
        }
    }

    private static long countUsersWithEmail(TestDatabase database, String email) throws SQLException {
        String sql = "SELECT count(*) FROM " + quotedSchema(database) + ".users WHERE email = ?";
        try (Connection connection = database.connect();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, email);
            try (var rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
                return rows.getLong(1);
            }
        }
    }

    private static void assertCustomerRoleWasBackfilled(TestDatabase database, UUID userId) throws SQLException {
        String sql = "SELECT role FROM " + quotedSchema(database) + ".user_roles WHERE user_id = ? ORDER BY role";
        try (Connection connection = database.connect();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, userId);
            try (var rows = statement.executeQuery()) {
                List<String> roles = new ArrayList<>();
                while (rows.next()) roles.add(rows.getString("role"));
                assertThat(roles).containsExactly("CUSTOMER");
            }
        }
    }

    private static void assertLegacyUserCanAuthenticate(HttpClient client,
                                                         ConfigurableApplicationContext application,
                                                         String username, String mobile, String email,
                                                         String identifier)
            throws Exception {
        URI base = URI.create("http://127.0.0.1:"
                + application.getEnvironment().getRequiredProperty("local.server.port"));
        String loginJson = """
                {"identifier":"%s","password":"%s"}
                """.formatted(identifier, LEGACY_PASSWORD);
        var login = send(client, base, "POST", "/api/auth/login", loginJson, null);
        assertThat(login.statusCode()).isEqualTo(200);
        Map<?, ?> session = JSON.readValue(login.body(), Map.class);
        assertThat(session.get("tokenType")).isEqualTo("Bearer");
        assertThat(session.get("accessToken")).isInstanceOf(String.class).isNotEqualTo("");
        assertThat(login.headers().allValues("Set-Cookie"))
                .anySatisfy(cookie -> assertThat(cookie)
                        .startsWith("MW_REFRESH=")
                        .contains("Path=/api/auth", "HttpOnly", "SameSite=Lax"));

        var profile = send(client, base, "GET", "/api/user/me", null,
                "Bearer " + session.get("accessToken"));
        assertThat(profile.statusCode()).isEqualTo(200);
        Map<?, ?> fields = JSON.readValue(profile.body(), Map.class);
        assertThat(fields.keySet().stream().map(Object::toString).toList())
                .containsExactlyInAnyOrder("username", "mobile", "email", "mobileVerified");
        assertThat(fields.get("username")).isEqualTo(username);
        assertThat(fields.get("mobile")).isEqualTo(mobile);
        assertThat(fields.get("email")).isEqualTo(email);
        assertThat(fields.get("mobileVerified")).isEqualTo(false);
    }

    private static HttpResponse<String> send(HttpClient client, URI base, String method, String path,
                                             String body, String authorization) throws Exception {
        var builder = HttpRequest.newBuilder(base.resolve(path))
                .timeout(Duration.ofSeconds(10))
                .header("X-Request-ID", UUID.randomUUID().toString());
        if (body != null) builder.header("Content-Type", "application/json");
        if (authorization != null) builder.header("Authorization", authorization);
        if ("GET".equals(method)) builder.GET();
        else builder.POST(HttpRequest.BodyPublishers.ofString(body));
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static List<String> appliedChangesets(TestDatabase database) throws SQLException {
        String sql = "SELECT id FROM " + quotedSchema(database) + ".databasechangelog ORDER BY orderexecuted";
        try (Connection connection = database.connect();
             var statement = connection.createStatement();
             var rows = statement.executeQuery(sql)) {
            List<String> ids = new ArrayList<>();
            while (rows.next()) ids.add(rows.getString("id"));
            return ids;
        }
    }

    private static String quotedSchema(TestDatabase database) {
        assertThat(database.schema()).matches("mw_it_[a-f0-9]{32}");
        return "\"" + database.schema() + "\"";
    }
}
