package bd.mediwish.auth;

import bd.mediwish.MediWishApplication;
import bd.mediwish.health.TestDatabase;
import bd.mediwish.web.Ticket03RoleAuthorizationTestConfiguration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
@Tag("security")
@Tag("regression")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class Ticket03AuthorizationIT {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private HttpClient client;
    private TestDatabase database;
    private ConfigurableApplicationContext application;
    private URI base;

    @BeforeAll
    void startAgainstIsolatedPostgresSchema() throws Exception {
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
        database = TestDatabase.create();
        var properties = new HashMap<>(database.applicationProperties());
        var launcher = new SpringApplication(MediWishApplication.class, Ticket03RoleAuthorizationTestConfiguration.class);
        launcher.setAdditionalProfiles("test");
        launcher.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("ticket-03-authorization-test", properties)));
        application = launcher.run();
        base = URI.create("http://127.0.0.1:"
                + application.getEnvironment().getRequiredProperty("local.server.port"));
    }

    @AfterAll
    void closeOnlyResourcesOwnedByThisRun() throws Exception {
        try {
            if (application != null) application.close();
        } finally {
            try {
                if (database != null) database.close();
            } finally {
                if (client != null) client.close();
            }
        }
    }

    @Test
    void protectedProfileRequiresCurrentRoleAndMatchingSessionOwner() throws Exception {
        var anonymous = getProfile(null);
        assertAuthenticationRequired(anonymous);
        var invalid = getProfile("Bearer invalid-synthetic-token");
        assertAuthenticationRequired(invalid);

        String suffix = UUID.randomUUID().toString().replace("-", "");
        String username = "role_probe_" + suffix.substring(0, 16);
        String mobile = "017" + suffix.substring(0, 9);
        String email = "role." + suffix.substring(0, 16) + "@example.test";
        String password = "synthetic-password-" + suffix;
        var registered = send("POST", "/api/auth/register", "register-" + suffix,
                """
                {"username":"%s","mobile":"%s","email":"%s","password":"%s"}
                """.formatted(username, mobile, email, password), null);
        assertThat(registered.statusCode()).isEqualTo(201);

        var login = send("POST", "/api/auth/login", "login-" + suffix,
                """
                {"identifier":"%s","password":"%s"}
                """.formatted(username, password), null);
        assertThat(login.statusCode()).isEqualTo(200);
        String accessToken = (String) JSON.readValue(login.body(), Map.class).get("accessToken");
        assertThat(accessToken).isNotBlank();

        var customerOnly = getProfile("Bearer " + accessToken);
        assertThat(customerOnly.statusCode()).isEqualTo(403);

        UUID userId = userId(username);
        replaceRole(userId, "CUSTOMER", "ADMIN");
        var grantedAfterLogin = getProfile("Bearer " + accessToken);
        assertThat(grantedAfterLogin.statusCode()).isEqualTo(200);

        String otherSuffix = UUID.randomUUID().toString().replace("-", "");
        String otherUsername = "role_probe_" + otherSuffix.substring(0, 16);
        String otherMobile = "017" + otherSuffix.substring(0, 9);
        String otherEmail = "role." + otherSuffix.substring(0, 16) + "@example.test";
        String otherPassword = "synthetic-password-" + otherSuffix;
        var otherRegistered = send("POST", "/api/auth/register", "register-" + otherSuffix,
                """
                {"username":"%s","mobile":"%s","email":"%s","password":"%s"}
                """.formatted(otherUsername, otherMobile, otherEmail, otherPassword), null);
        assertThat(otherRegistered.statusCode()).isEqualTo(201);

        var otherLogin = send("POST", "/api/auth/login", "login-" + otherSuffix,
                """
                {"identifier":"%s","password":"%s"}
                """.formatted(otherUsername, otherPassword), null);
        assertThat(otherLogin.statusCode()).isEqualTo(200);
        String otherAccessToken = (String) JSON.readValue(otherLogin.body(), Map.class).get("accessToken");
        UUID otherUserId = userId(otherUsername);
        replaceRole(otherUserId, "CUSTOMER", "ADMIN");
        assertThat(getProfile("Bearer " + otherAccessToken).statusCode()).isEqualTo(200);

        AccessTokenCodec accessTokens = application.getBean(AccessTokenCodec.class);
        UUID sessionId = accessTokens.verify(accessToken).sessionId();
        UUID otherSessionId = accessTokens.verify(otherAccessToken).sessionId();
        assertThat(otherSessionId).isNotEqualTo(sessionId);

        String tokenWithAnotherUsersSession = accessTokens.issue(userId, otherSessionId).token();
        assertAuthenticationRequired(getProfile("Bearer " + tokenWithAnotherUsersSession));
        String tokenWithAnotherUsersSubject = accessTokens.issue(otherUserId, sessionId).token();
        assertAuthenticationRequired(getProfile("Bearer " + tokenWithAnotherUsersSubject));

        String tokenWithNonexistentSession = accessTokens.issue(userId, UUID.randomUUID()).token();
        assertAuthenticationRequired(getProfile("Bearer " + tokenWithNonexistentSession));

        replaceRole(userId, "ADMIN", "CUSTOMER");
        var revokedAfterLogin = getProfile("Bearer " + accessToken);
        assertThat(revokedAfterLogin.statusCode()).isEqualTo(403);
    }

    private void assertAuthenticationRequired(HttpResponse<String> response) throws Exception {
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(response.headers().firstValue("WWW-Authenticate")).contains("Bearer");
        Map<?, ?> body = JSON.readValue(response.body(), Map.class);
        assertThat(body.get("code")).isEqualTo("AUTHENTICATION_REQUIRED");
        assertThat(response.body()).hasSizeLessThan(512);
    }

    private HttpResponse<String> getProfile(String authorization) throws Exception {
        return send("GET", "/api/user/me", "profile-" + UUID.randomUUID(), null, authorization);
    }

    private HttpResponse<String> send(String method, String path, String requestId,
                                      String body, String authorization) throws Exception {
        var builder = HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(10))
                .header("X-Request-ID", requestId);
        if (body != null) builder.header("Content-Type", "application/json");
        if (authorization != null) builder.header("Authorization", authorization);
        var publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body);
        return client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString());
    }

    private UUID userId(String username) throws Exception {
        try (var connection = database.connect();
             var statement = connection.prepareStatement("SELECT id FROM " + table("users") + " WHERE username = ?")) {
            statement.setString(1, username);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return result.getObject(1, UUID.class);
            }
        }
    }

    private void replaceRole(UUID userId, String oldRole, String newRole) throws Exception {
        try (var connection = database.connect();
             var statement = connection.prepareStatement("UPDATE " + table("user_roles")
                     + " SET role = ? WHERE user_id = ? AND role = ?")) {
            statement.setString(1, newRole);
            statement.setObject(2, userId);
            statement.setString(3, oldRole);
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private String table(String name) {
        assertThat(database.schema()).matches("mw_it_[a-f0-9]{32}");
        return "\"" + database.schema() + "\".\"" + name + "\"";
    }
}
