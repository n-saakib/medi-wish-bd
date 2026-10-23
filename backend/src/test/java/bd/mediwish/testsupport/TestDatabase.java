package bd.mediwish.testsupport;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Owns one disposable schema, never a database or another run's schema. */
public final class TestDatabase implements AutoCloseable {
    private static final String SYNTHETIC_JWT_SECRET = Base64.getEncoder().encodeToString(
            "medi-wish-integration-test-jwt-key-material".getBytes(StandardCharsets.UTF_8));
    private static final String[] TEST_SETTINGS = {
            "TEST_DB_HOST", "TEST_DB_PORT", "TEST_DB_NAME", "TEST_DB_USERNAME", "TEST_DB_PASSWORD"
    };
    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final String schema = "mw_it_" + UUID.randomUUID().toString().replace("-", "");
    private boolean created;

    private TestDatabase() {
        var settings = loadSettings();
        host = defaulted(settings, "TEST_DB_HOST", "localhost");
        port = Integer.parseInt(defaulted(settings, "TEST_DB_PORT", "5432"));
        validateTarget(settings.get("TEST_DB_NAME"), schema);
        username = required(settings, "TEST_DB_USERNAME");
        password = required(settings, "TEST_DB_PASSWORD");
        if (!host.matches("[a-zA-Z0-9.:-]+") || port < 1 || port > 65535) {
            throw new IllegalArgumentException("Invalid test database host or port");
        }
    }

    private static Map<String, String> loadSettings() {
        Map<String, String> settings = new HashMap<>();
        locateDotEnv().ifPresent(path -> settings.putAll(readDotEnv(path)));
        for (String name : TEST_SETTINGS) {
            String environment = System.getenv(name);
            if (environment != null) {
                settings.put(name, environment);
                continue;
            }
            String systemProperty = System.getProperty(name);
            if (systemProperty != null) {
                settings.put(name, systemProperty);
            }
        }
        return settings;
    }

    private static String defaulted(Map<String, String> settings, String name, String fallback) {
        String value = settings.get(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static Optional<Path> locateDotEnv() {
        Path workingDirectory = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        Path parent = workingDirectory.getParent();
        Path[] backendRoots = {
                workingDirectory,
                workingDirectory.resolve("backend"),
                parent,
                parent == null ? null : parent.resolve("backend")
        };
        for (Path backendRoot : backendRoots) {
            if (backendRoot == null || !Files.isRegularFile(backendRoot.resolve("pom.xml"))) {
                continue;
            }
            Path envFile = backendRoot.resolve(".env");
            if (Files.isRegularFile(envFile)) {
                return Optional.of(envFile);
            }
        }
        return Optional.empty();
    }

    static Map<String, String> readDotEnv(Path file) {
        Map<String, String> settings = new HashMap<>();
        if (!Files.isRegularFile(file)) {
            return settings;
        }
        try {
            for (String rawLine : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                String line = rawLine.trim();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }
                int separator = line.indexOf('=');
                if (separator <= 0) {
                    continue;
                }
                String name = line.substring(0, separator).trim();
                if (!name.matches("[A-Z][A-Z0-9_]*")) {
                    continue;
                }
                settings.put(name, line.substring(separator + 1).trim());
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to read the local .env file", exception);
        }
        return settings;
    }

    public static TestDatabase create() throws SQLException {
        var database = new TestDatabase();
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            database.verifyDatabase(connection);
            statement.execute("CREATE SCHEMA " + database.schema);
            database.created = true;
            return database;
        }
    }

    static void validateTarget(String database, String schema) {
        if (!"medi_wish_test".equals(database) || schema == null
                || !schema.matches("mw_it_[a-f0-9]{32}")) {
            throw new IllegalArgumentException("Integration tests require medi_wish_test and a run-owned schema");
        }
    }

    static void validateTestDatabaseConnection(
            String database, int serverVersion, String connectedRole, String configuredRole,
            boolean superuser, boolean canCreateDatabase, boolean canCreateRoles) {
        if (!"medi_wish_test".equals(database)) {
            throw new IllegalStateException("Integration tests require medi_wish_test");
        }
        if (serverVersion / 10000 != 18) {
            throw new IllegalStateException("Integration tests require PostgreSQL 18");
        }
        if (connectedRole == null || connectedRole.isBlank() || !connectedRole.equals(configuredRole)) {
            throw new IllegalStateException("Integration tests require the configured PostgreSQL test role");
        }
        if (superuser || canCreateDatabase || canCreateRoles) {
            throw new IllegalStateException("Integration test role must not have SUPERUSER, CREATEDB, or CREATEROLE");
        }
    }

    private static String required(Map<String, String> settings, String name) {
        var value = settings.get(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing " + name + "; integration tests never fall back to development credentials");
        }
        return value;
    }

    /** A connection whose unqualified names resolve in this run's schema. */
    public Connection connect() throws SQLException {
        return DriverManager.getConnection("jdbc:postgresql://" + host + ":" + port
                + "/medi_wish_test?currentSchema=" + schema + "&connectTimeout=2&socketTimeout=3", username, password);
    }

    /** Runs one statement in this schema and returns its update count. */
    public int update(String sql, Object... parameters) throws SQLException {
        try (var connection = connect(); var statement = connection.prepareStatement(sql)) {
            bind(statement, parameters);
            return statement.executeUpdate();
        }
    }

    /** Maps every row a query in this schema returns. */
    public <T> List<T> query(String sql, Row<T> row, Object... parameters) throws SQLException {
        try (var connection = connect(); var statement = connection.prepareStatement(sql)) {
            bind(statement, parameters);
            try (var result = statement.executeQuery()) {
                List<T> rows = new ArrayList<>();
                while (result.next()) rows.add(row.map(result));
                return rows;
            }
        }
    }

    /** The first column of the single row a query in this schema returns. */
    public <T> T single(String sql, Class<T> type, Object... parameters) throws SQLException {
        List<T> values = query(sql, result -> result.getObject(1, type), parameters);
        if (values.size() != 1) throw new IllegalStateException("Expected one row but found " + values.size());
        return values.getFirst();
    }

    private static void bind(PreparedStatement statement, Object... parameters) throws SQLException {
        for (int i = 0; i < parameters.length; i++) statement.setObject(i + 1, parameters[i]);
    }

    @FunctionalInterface
    public interface Row<T> {
        T map(ResultSet result) throws SQLException;
    }

    private void verifyDatabase(Connection connection) throws SQLException {
        try (var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT current_database(), "
                     + "current_setting('server_version_num')::integer, current_user, "
                     + "rol.rolsuper, rol.rolcreatedb, rol.rolcreaterole "
                     + "FROM pg_roles AS rol WHERE rol.rolname = current_user")) {
            if (!result.next()) {
                throw new IllegalStateException("Integration tests could not verify the PostgreSQL test role");
            }
            validateTestDatabaseConnection(result.getString(1), result.getInt(2),
                    result.getString(3), username, result.getBoolean(4), result.getBoolean(5), result.getBoolean(6));
        }
    }

    public Map<String, Object> applicationProperties() {
        return applicationProperties(port);
    }

    public Map<String, Object> applicationProperties(int connectionPort) {
        Map<String, Object> properties = new HashMap<>();
        properties.put("server.port", "0");
        String connectionHost = connectionPort == port ? host : "127.0.0.1";
        properties.put("spring.datasource.url", "jdbc:postgresql://" + connectionHost + ":" + connectionPort
                + "/medi_wish_test?currentSchema=" + schema + "&connectTimeout=2&socketTimeout=3");
        properties.put("spring.datasource.username", username);
        properties.put("spring.datasource.password", password);
        properties.put("spring.liquibase.default-schema", schema);
        properties.put("spring.liquibase.liquibase-schema", schema);
        properties.put("spring.jpa.properties.hibernate.default_schema", schema);
        // Keeps JobRunr's tables in this schema too when the compatibility profile puts it on the classpath.
        properties.put("jobrunr.database.table-prefix", schema + ".");
        properties.put("app.notification.security.adapter", "capture");
        properties.putAll(syntheticAuthProperties());
        properties.putAll(syntheticStorageProperties(storageNamespace()));
        return properties;
    }

    /** Supplies non-production auth configuration required by isolated application startups. */
    public static Map<String, Object> syntheticAuthProperties() {
        return Map.of(
                "app.auth.jwt-secret", SYNTHETIC_JWT_SECRET,
                "app.auth.mfa.secret-key", TestAuthSettings.MFA_SECRET_KEY,
                "app.auth.recovery.code-key", TestAuthSettings.RECOVERY_CODE_KEY,
                "app.auth.cookie.secure", "false");
    }

    private String storageNamespace() { return "test-it-" + schema.substring("mw_it_".length()); }

    public static Map<String, Object> syntheticStorageProperties(String namespace) {
        if (namespace == null || !namespace.matches("test-[a-z0-9-]{1,58}"))
            throw new IllegalArgumentException("Invalid test storage namespace");
        return Map.of("app.storage.provider", "local", "app.storage.local-root", storageRoot().toString(),
                "app.storage.namespace", namespace);
    }

    private static Path storageRoot() {
        Path working = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        Path parent = working.getParent();
        for (Path candidate : new Path[] { working, working.resolve("backend"), parent,
                parent == null ? null : parent.resolve("backend") }) {
            if (candidate != null && Files.isRegularFile(candidate.resolve("pom.xml")))
                return candidate.resolve("target/test-object-storage").toAbsolutePath().normalize();
        }
        throw new IllegalStateException("Backend root not found");
    }

    private void deleteStorage() {
        Path root = storageRoot();
        Path namespace = root.resolve(storageNamespace()).normalize();
        if (!namespace.startsWith(root)) throw new IllegalStateException("Invalid test storage path");
        if (!Files.exists(namespace)) return;
        try (var paths = Files.walk(namespace)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(path);
        } catch (IOException error) { throw new IllegalStateException("Unable to clean test storage", error); }
    }

    public String schema() { return schema; }
    public String host() { return host; }
    public int port() { return port; }

    @Override
    public void close() throws SQLException {
        if (!created) return;
        validateTarget("medi_wish_test", schema);
        try (var connection = connect(); var statement = connection.createStatement()) {
            verifyDatabase(connection);
            statement.execute("DROP SCHEMA " + schema + " CASCADE");
            created = false;
            deleteStorage();
        }
    }
}
