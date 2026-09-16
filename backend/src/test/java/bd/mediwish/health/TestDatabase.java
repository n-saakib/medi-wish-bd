package bd.mediwish.health;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Owns one disposable schema, never a database or another run's schema. */
public final class TestDatabase implements AutoCloseable {
    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final String schema = "mw_it_" + UUID.randomUUID().toString().replace("-", "");
    private boolean created;

    private TestDatabase() {
        host = System.getenv().getOrDefault("TEST_DB_HOST", "localhost");
        port = Integer.parseInt(System.getenv().getOrDefault("TEST_DB_PORT", "5432"));
        validateTarget(System.getenv("TEST_DB_NAME"), schema);
        username = required("TEST_DB_USERNAME");
        password = required("TEST_DB_PASSWORD");
        if (!host.matches("[a-zA-Z0-9.:-]+") || port < 1 || port > 65535) {
            throw new IllegalArgumentException("Invalid test database host or port");
        }
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

    private static String required(String name) {
        var value = System.getenv(name);
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
        return properties;
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
