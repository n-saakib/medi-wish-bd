package bd.mediwish.catalog;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestDatabase;
import org.bouncycastle.util.encoders.Base32;
import tools.jackson.databind.json.JsonMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Real HTTP catalog fixture with run-owned PostgreSQL and staff sessions verified through the MFA API. */
final class CatalogTestApi implements AutoCloseable {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final List<String> CATALOG_FIELDS = List.of("name", "brandName", "genericName", "manufacturer",
            "dosageForm", "saleUnit", "description", "categoryId", "requireValidation");

    private final TestDatabase database;
    private final TestApplication application;

    private CatalogTestApi(TestDatabase database, TestApplication application) {
        this.database = database;
        this.application = application;
    }

    static CatalogTestApi start() throws Exception {
        return start(3);
    }

    /** Concurrency fixtures keep the JDBC read timeout beyond their bounded lock-observation deadline. */
    static CatalogTestApi start(int socketTimeoutSeconds) throws Exception {
        TestDatabase database = TestDatabase.create();
        try {
            return new CatalogTestApi(database,
                    TestApplication.start(applicationProperties(database.applicationProperties(), socketTimeoutSeconds)));
        } catch (Exception failure) {
            database.close();
            throw failure;
        }
    }

    static Map<String, Object> applicationProperties(Map<String, Object> source, int socketTimeoutSeconds) {
        if (socketTimeoutSeconds < 1) throw new IllegalArgumentException("Socket timeout must be positive");
        Map<String, Object> properties = new HashMap<>(source);
        String url = (String) source.get("spring.datasource.url");
        properties.put("spring.datasource.url",
                url.replaceAll("(?<=[?&]socketTimeout=)[0-9]+", Integer.toString(socketTimeoutSeconds)));
        return properties;
    }

    TestDatabase database() { return database; }
    TestApplication application() { return application; }

    record Actor(UUID userId, String username, String token, String role) {}

    /** Registers a synthetic User, gives them one role, and signs in through the real API. */
    Actor actor(String role) throws Exception {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String username = "catalog_" + suffix;
        String mobile = "017" + String.format("%08d", RANDOM.nextInt(100_000_000));
        String password = "Synthetic-" + suffix + "-1";
        var registration = send("POST", "/api/auth/register", (String) null,
                Map.of("username", username, "mobile", mobile, "email", "catalog." + suffix + "@example.test",
                        "password", password));
        assertThat(registration.statusCode()).isEqualTo(201);
        UUID userId = database.single("SELECT id FROM users WHERE username = ?", UUID.class, username);
        if (!"CUSTOMER".equals(role)) {
            String storedRole = "RESTRICTED_ADMIN".equals(role) ? "ADMIN" : role;
            assertThat(database.update("UPDATE user_roles SET role = ? WHERE user_id = ?", storedRole, userId)).isOne();
        }
        var login = send("POST", "/api/auth/login", (String) null,
                Map.of("identifier", username, "password", password));
        assertThat(login.statusCode()).isEqualTo(200);
        Map<String, Object> session = json(login);
        String token = (String) session.get("accessToken");
        if ("ADMIN".equals(role) || "MODERATOR".equals(role)) {
            assertThat(session.get("mfa")).isEqualTo("ENROLLMENT_REQUIRED");
            var started = send("POST", "/api/auth/mfa/enrollment", token, null);
            assertThat(started.statusCode()).isEqualTo(201);
            Map<String, Object> enrollment = json(started);
            var verified = send("POST", "/api/auth/mfa/enrollment/verify", token,
                    Map.of("enrollmentId", enrollment.get("enrollmentId"),
                            "code", totp((String) enrollment.get("secret"))));
            assertThat(verified.statusCode()).isEqualTo(200);
            assertThat(json(verified).get("mfa")).isEqualTo("VERIFIED");
            token = (String) json(verified).get("accessToken");
        } else {
            assertThat(session.get("mfa")).isEqualTo(
                    "DELIVERY_PERSON".equals(role) || "CUSTOMER".equals(role)
                            ? "NOT_REQUIRED" : "ENROLLMENT_REQUIRED");
        }
        return new Actor(userId, username, token, role);
    }

    /** An Admin without an authenticator: the session is deliberately MFA-restricted. */
    Actor restrictedAdmin() throws Exception {
        return actor("RESTRICTED_ADMIN");
    }

    HttpResponse<String> send(String method, String path, Actor actor, Object body) throws Exception {
        return send(method, path, actor == null ? null : actor.token(), body);
    }

    HttpResponse<String> send(String method, String path, String token, Object body) throws Exception {
        Map<String, String> headers = new HashMap<>();
        if (token != null) headers.put("Authorization", "Bearer " + token);
        String encoded = null;
        if (body != null) {
            headers.put("Content-Type", "application/json");
            encoded = body instanceof String raw ? raw : JSON.writeValueAsString(body);
        }
        return application.send(method, path, headers, encoded);
    }

    Map<String, Object> category(Actor actor, String name) throws Exception {
        var response = send("POST", "/api/staff/categories", actor, Map.of("id", UUID.randomUUID(), "name", name));
        assertThat(response.statusCode()).isEqualTo(201);
        return json(response);
    }

    Map<String, Object> medicine(Actor actor, UUID categoryId) throws Exception {
        return createProduct(actor, draft("MEDICINE", categoryId));
    }

    Map<String, Object> equipment(Actor actor, UUID categoryId) throws Exception {
        return createProduct(actor, draft("EQUIPMENT", categoryId));
    }

    Map<String, Object> createProduct(Actor actor, Map<String, Object> draft) throws Exception {
        var response = send("POST", "/api/staff/products", actor, draft);
        assertThat(response.statusCode()).isEqualTo(201);
        return json(response);
    }

    static Map<String, Object> draft(String kind, UUID categoryId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", UUID.randomUUID());
        body.put("kind", kind);
        body.put("name", kind.equals("MEDICINE") ? "Synthetic medicine " + UUID.randomUUID()
                : "Synthetic equipment " + UUID.randomUUID());
        body.put("brandName", null);
        body.put("genericName", kind.equals("MEDICINE") ? "Synthetic generic" : null);
        body.put("manufacturer", null);
        body.put("dosageForm", kind.equals("MEDICINE") ? "Tablet 500 mg" : null);
        body.put("saleUnit", kind.equals("MEDICINE") ? "Strip of 10 tablets" : "1 piece");
        body.put("description", null);
        body.put("categoryId", categoryId);
        body.put("requireValidation", false);
        return body;
    }

    static Map<String, Object> catalogBody(Map<String, Object> product, Map<String, Object> changes) {
        Map<String, Object> body = new LinkedHashMap<>();
        for (String field : CATALOG_FIELDS) body.put(field, product.get(field));
        body.put("active", product.get("active"));
        body.put("version", product.get("version"));
        body.putAll(changes);
        return body;
    }

    Map<String, Object> price(Actor actor, Map<String, Object> product, String sellingPrice, String mrp)
            throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("sellingPrice", sellingPrice);
        body.put("mrp", mrp);
        body.put("version", product.get("version"));
        var response = send("PUT", "/api/staff/products/" + product.get("id") + "/pricing", actor, body);
        assertThat(response.statusCode()).isEqualTo(200);
        return json(response);
    }

    Map<String, Object> edit(Actor actor, Map<String, Object> product, Map<String, Object> changes) throws Exception {
        var response = send("PUT", "/api/staff/products/" + product.get("id"), actor, catalogBody(product, changes));
        assertThat(response.statusCode()).isEqualTo(200);
        return json(response);
    }

    Map<String, Object> get(Actor actor, Object id) throws Exception {
        var response = send("GET", "/api/staff/products/" + id, actor, null);
        assertThat(response.statusCode()).isEqualTo(200);
        return json(response);
    }

    void replaceRole(Actor actor, String role) throws SQLException {
        assertThat(database.update("UPDATE user_roles SET role = ? WHERE user_id = ?", role, actor.userId())).isOne();
    }

    private static String totp(String base32Secret) throws Exception {
        byte[] key = Base32.decode(base32Secret);
        byte[] counter = ByteBuffer.allocate(8).putLong(Instant.now().getEpochSecond() / 30).array();
        Mac mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(key, "HmacSHA1"));
        byte[] hash = mac.doFinal(counter);
        int offset = hash[hash.length - 1] & 0x0f;
        int value = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16)
                | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
        return String.format("%06d", value % 1_000_000);
    }

    @Override
    public void close() throws Exception {
        try {
            application.close();
        } finally {
            database.close();
        }
    }
}
