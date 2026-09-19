package bd.mediwish.health;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.Base64;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

/** Owns one disposable schema, never a database or another run's schema. */
public final class TestDatabase implements AutoCloseable {
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

    private static String required(Map<String, String> settings, String name) {
        var value = settings.get(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing " + name + "; integration tests never fall back to development credentials");
        }
        return value;
    }

    public Connection connect() throws SQLException {
        return DriverManager.getConnection("jdbc:postgresql://" + host + ":" + port
                + "/medi_wish_test?connectTimeout=2&socketTimeout=3", username, password);
    }

    private void verifyDatabase(Connection connection) throws SQLException {
        try (var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT current_database(), current_setting('server_version_num')::integer")) {
            if (!result.next() || !"medi_wish_test".equals(result.getString(1))
                    || result.getInt(2) / 10000 != 18) {
                throw new IllegalStateException("Integration tests require the explicit PostgreSQL 18 test database");
            }
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
        properties.putAll(syntheticAuthProperties());
        return properties;
    }

    /** Supplies non-production auth configuration required by isolated application startups. */
    public static Map<String, Object> syntheticAuthProperties() {
        return Map.of(
                "app.auth.jwt-secret", SyntheticAuth.JWT_SECRET,
                "app.auth.dummy-password-verifier", SyntheticAuth.DUMMY_PASSWORD_VERIFIER,
                "app.auth.cookie.secure", "false");
    }

    private static final class SyntheticAuth {
        private static final String JWT_SECRET = Base64.getEncoder().encodeToString(
                "medi-wish-integration-test-jwt-key-material".getBytes(StandardCharsets.UTF_8));
        private static final String DUMMY_PASSWORD_VERIFIER = Argon2PasswordEncoder
                .defaultsForSpringSecurity_v5_8().encode("integration-test-dummy-input");

        private SyntheticAuth() {}
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
        }
    }
}
