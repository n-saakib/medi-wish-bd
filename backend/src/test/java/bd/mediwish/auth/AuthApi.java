package bd.mediwish.auth;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestDatabase;
import org.bouncycastle.util.encoders.Base32;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.api.extension.ParameterContext;
import org.junit.jupiter.api.extension.ParameterResolver;
import org.springframework.boot.test.system.CapturedOutput;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.http.HttpResponse;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static bd.mediwish.testsupport.ApiAssertions.assertOmits;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Calls the auth API as the storefront does and reads the rows it changes. Every credential and contact value it
 * creates or receives is tracked, and every error or 204 response is checked to contain none of them.
 */
final class AuthApi implements AutoCloseable {
    static final String ALLOWED_ORIGIN = "http://127.0.0.1:3000";
    static final Map<String, String> JSON_CONTENT = Map.of("Content-Type", "application/json");
    static final String CLEARED_REFRESH_COOKIE =
            "MW_REFRESH=; Path=/api/auth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax";
    private static final Pattern REFRESH_COOKIE = Pattern.compile(
            "MW_REFRESH=([A-Za-z0-9_-]{43}); Path=/api/auth; Max-Age=(\\d+); Expires=[^;]+; HttpOnly; SameSite=Lax");
    static final long REFRESH_LIFETIME_SECONDS = 30L * 24 * 60 * 60;
    private static final long RESTRICTED_LIFETIME_SECONDS = 10L * 60;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final TestDatabase database;
    private final TestApplication app;
    private final Set<String> secrets = ConcurrentHashMap.newKeySet();
    private String csrf;

    private AuthApi(TestDatabase database, TestApplication app) {
        this.database = database;
        this.app = app;
    }

    /** A new schema and application; the caller closes both through {@link #close()}. */
    static AuthApi start(Class<?>... testConfigurations) {
        TestDatabase database;
        try {
            database = TestDatabase.create();
        } catch (SQLException exception) {
            throw new IllegalStateException("Could not create the integration test schema", exception);
        }
        try {
            return new AuthApi(database, TestApplication.start(database.applicationProperties(), testConfigurations));
        } catch (RuntimeException exception) {
            try {
                database.close();
            } catch (SQLException closing) {
                exception.addSuppressed(closing);
            }
            throw exception;
        }
    }

    TestDatabase database() {
        return database;
    }

    TestApplication app() {
        return app;
    }

    record User(String username, String mobile, String email, String password) {
        Map<String, Object> profile(boolean mobileVerified) {
            var profile = new HashMap<String, Object>();
            profile.put("username", username);
            profile.put("mobile", mobile);
            profile.put("email", email);
            profile.put("mobileVerified", mobileVerified);
            return profile;
        }
    }

    record Session(String accessToken, String refreshToken, Map<String, Object> user) {}

    record Generation(long number, boolean consumed) {}

    /** Unique synthetic values; the mobile is digits only, like a real one. */
    User newUser() {
        String suffix = random(6);
        return new User(track("user_" + suffix), track("017" + String.format("%08d", RANDOM.nextInt(100_000_000))),
                track("user." + suffix + "@example.test"), track("synthetic-pw-" + random(8)));
    }

    User newUserWithoutEmail() {
        User user = newUser();
        return new User(user.username(), user.mobile(), null, user.password());
    }

    User registered() throws Exception {
        return register(newUser());
    }

    User register(User user) throws Exception {
        var response = post("/api/auth/register", JSON_CONTENT, registration(user));
        assertThat(response.statusCode()).isEqualTo(201);
        var expected = new HashMap<String, Object>(user.profile(false));
        expected.remove("mobileVerified");
        expected.put("mobileVerificationDeferred", true);
        assertThat(json(response)).isEqualTo(expected);
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
        return user;
    }

    static String registration(User user) {
        var fields = new LinkedHashMap<String, String>();
        fields.put("username", user.username());
        fields.put("mobile", user.mobile());
        if (user.email() != null) fields.put("email", user.email());
        fields.put("password", user.password());
        return JSON.writeValueAsString(fields);
    }

    HttpResponse<String> login(String identifier, String password) throws Exception {
        return post("/api/auth/login", JSON_CONTENT,
                JSON.writeValueAsString(Map.of("identifier", identifier, "password", password)));
    }

    Session signIn(User user) throws Exception {
        return session(login(user.username(), user.password()));
    }

    /** The 200 session contract: a 15-minute Bearer token, the profile, and a 30-day HttpOnly refresh cookie. */
    Session session(HttpResponse<String> response) {
        return session(response, "NOT_REQUIRED");
    }

    /**
     * The session contract for the expected assurance. A staff password sign-in lasts 10 minutes, so its access
     * token and refresh cookie end with it; every other new session has the 15-minute token and the 30-day cookie.
     */
    Session session(HttpResponse<String> response, String mfa) {
        boolean restricted = mfa.equals("ENROLLMENT_REQUIRED") || mfa.equals("VERIFICATION_REQUIRED");
        return session(response, mfa, restricted ? RESTRICTED_LIFETIME_SECONDS : REFRESH_LIFETIME_SECONDS);
    }

    /** The session contract for a session with about {@code lifetime} seconds left. */
    Session session(HttpResponse<String> response, String mfa, long lifetime) {
        assertThat(response.statusCode()).isEqualTo(200);
        Map<String, Object> body = json(response);
        assertThat(body).containsOnlyKeys(mfa.equals("VERIFIED") && body.containsKey("backupCodes")
                        ? new String[]{"accessToken", "tokenType", "expiresIn", "user", "mfa", "backupCodes"}
                        : new String[]{"accessToken", "tokenType", "expiresIn", "user", "mfa"})
                .containsEntry("tokenType", "Bearer").containsEntry("mfa", mfa);
        if (lifetime < 900) {
            assertThat(((Number) body.get("expiresIn")).longValue()).isBetween(lifetime - 60, lifetime);
        } else {
            assertThat(body).containsEntry("expiresIn", 900);
        }
        @SuppressWarnings("unchecked") var user = (Map<String, Object>) body.get("user");
        assertThat(user).containsOnlyKeys("username", "mobile", "email", "mobileVerified");
        var cookies = response.headers().allValues("Set-Cookie").stream()
                .filter(cookie -> cookie.startsWith("MW_REFRESH=")).toList();
        assertThat(cookies).hasSize(1);
        var cookie = REFRESH_COOKIE.matcher(cookies.getFirst());
        assertThat(cookie.matches()).as("the refresh cookie value and attributes").isTrue();
        assertThat(Long.parseLong(cookie.group(2))).isBetween(lifetime - 60, lifetime);
        String refreshToken = track(cookie.group(1));
        assertOmits("session body", response.body(), List.of(refreshToken));
        return new Session(track((String) body.get("accessToken")), refreshToken, user);
    }

    /** A 401 that tells the browser to drop its refresh cookie. */
    static void assertRefreshCookieCleared(HttpResponse<String> response) {
        assertThat(response.headers().allValues("Set-Cookie")).containsExactly(CLEARED_REFRESH_COOKIE);
    }

    /** The server-issued CSRF token, read once from the bootstrap body and its cookie. */
    synchronized String csrf() throws Exception {
        if (csrf == null) {
            var response = send("GET", "/api/auth/csrf", Map.of(), null);
            assertThat(response.statusCode()).isEqualTo(200);
            String token = (String) json(response).get("csrfToken");
            assertThat(response.headers().allValues("Set-Cookie")).anyMatch(cookie ->
                    cookie.startsWith("XSRF-TOKEN=" + token + ";"));
            csrf = track(token);
        }
        return csrf;
    }

    HttpResponse<String> refresh(String... refreshTokens) throws Exception {
        return post("/api/auth/refresh", protectedHeaders(refreshTokens), null);
    }

    HttpResponse<String> logout(String... refreshTokens) throws Exception {
        return post("/api/auth/logout", protectedHeaders(refreshTokens), null);
    }

    /** What the storefront sends to a CSRF-protected route: the refresh cookies, the CSRF pair and its Origin. */
    Map<String, String> protectedHeaders(String... refreshTokens) throws Exception {
        String token = csrf();
        String cookies = Arrays.stream(refreshTokens).map(value -> "MW_REFRESH=" + value + "; ")
                .collect(Collectors.joining()) + "XSRF-TOKEN=" + token;
        return Map.of("Cookie", cookies, "X-XSRF-TOKEN", token, "Origin", ALLOWED_ORIGIN);
    }

    HttpResponse<String> profile(String accessToken) throws Exception {
        return send("GET", "/api/user/me", Map.of("Authorization", "Bearer " + accessToken), null);
    }

    HttpResponse<String> staffMe(String accessToken) throws Exception {
        return send("GET", "/api/staff/me", bearer(accessToken), null);
    }

    /** Starts authenticator enrollment and returns its 201 body; the seed is tracked as a secret. */
    Map<String, Object> startEnrollment(String accessToken) throws Exception {
        var response = post("/api/auth/mfa/enrollment", bearer(accessToken), null);
        assertThat(response.statusCode()).isEqualTo(201);
        Map<String, Object> body = json(response);
        assertThat(body).containsOnlyKeys("enrollmentId", "secret", "otpauthUri", "expiresIn")
                .containsEntry("expiresIn", 600);
        assertThat((String) body.get("enrollmentId")).matches(TestApplication.UUID_PATTERN);
        assertThat((String) body.get("secret")).matches("[A-Z2-7]{32}");
        track((String) body.get("secret"));
        return body;
    }

    HttpResponse<String> verifyEnrollment(String accessToken, Object enrollmentId, String code) throws Exception {
        var fields = new HashMap<String, Object>();
        fields.put("enrollmentId", enrollmentId);
        fields.put("code", code);
        return post("/api/auth/mfa/enrollment/verify", bearerJson(accessToken), JSON.writeValueAsString(fields));
    }

    HttpResponse<String> verifyMfa(String accessToken, String code) throws Exception {
        var fields = new HashMap<String, Object>();
        fields.put("code", code);
        return post("/api/auth/mfa/verify", bearerJson(accessToken), JSON.writeValueAsString(fields));
    }

    /**
     * Signs a staff User in and enrolls their authenticator; returns the verified session, the Base32 seed and the
     * backup codes, all tracked as secrets.
     */
    Enrolled enroll(User user) throws Exception {
        String restricted = session(login(user.username(), user.password()), "ENROLLMENT_REQUIRED").accessToken();
        var enrollment = startEnrollment(restricted);
        String secret = (String) enrollment.get("secret");
        var response = verifyEnrollment(restricted, enrollment.get("enrollmentId"), totp(secret, 0));
        Session session = session(response, "VERIFIED");
        @SuppressWarnings("unchecked") var codes = (List<String>) json(response).get("backupCodes");
        assertThat(codes).hasSize(10).allMatch(code -> code.matches("[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}"));
        codes.forEach(this::track);
        return new Enrolled(session, secret, codes);
    }

    record Enrolled(Session session, String secret, List<String> backupCodes) {}

    /** The authenticator code for the current 30-second step plus {@code stepOffset}. */
    static String totp(String base32Secret, int stepOffset) {
        return Totp.code(Base32.decode(base32Secret), Totp.step(Instant.now()) + stepOffset);
    }

    void grantRole(User user, String role) throws SQLException {
        assertThat(database.update("UPDATE user_roles SET role = ? WHERE user_id = ?", role, userId(user))).isOne();
    }

    void removeRole(User user, String role) throws SQLException {
        assertThat(database.update("UPDATE user_roles SET role = 'CUSTOMER' WHERE user_id = ? AND role = ?", userId(user), role)).isOne();
    }

    /** Admin read/command routes use a Bearer token only; filters stay in the JSON body. */
    HttpResponse<String> adminUsers(String token, Map<String, Object> filter) throws Exception {
        return post("/api/admin/users/search", bearerJson(token), JSON.writeValueAsString(filter));
    }

    HttpResponse<String> adminUser(String token, UUID id) throws Exception {
        return send("GET", "/api/admin/users/" + id, bearer(token), null);
    }

    HttpResponse<String> putRole(String token, UUID id, String role, long version) throws Exception {
        return send("PUT", "/api/admin/users/" + id + "/roles", bearerJson(token),
                JSON.writeValueAsString(Map.of("role", role, "rolesVersion", version)));
    }

    record VerifiedStaff(User user, Enrolled enrolled) {
        String token() { return enrolled.session().accessToken(); }
    }

    VerifiedStaff verifiedAdmin() throws Exception {
        User user = registered();
        grantRole(user, "ADMIN");
        return new VerifiedStaff(user, enroll(user));
    }

    /** Uses the real provisioning transaction, once per owned schema, then the real MFA enrollment. */
    VerifiedStaff verifiedSuperAdmin() throws Exception {
        User user = registered();
        assertThat(app.bean(FirstAdminProvisioningService.class).provision(user.username()))
                .isEqualTo(FirstAdminProvisioningService.Outcome.PROVISIONED);
        return new VerifiedStaff(user, enroll(user));
    }
    /** Clears the User's wrong-code count and lock, as the lockout expiring would. */
    void clearMfaThrottle(User user) throws SQLException {
        database.update("DELETE FROM staff_mfa_throttle WHERE user_id = ?", userId(user));
    }

    private static Map<String, String> bearer(String accessToken) {
        return Map.of("Authorization", "Bearer " + accessToken);
    }

    private static Map<String, String> bearerJson(String accessToken) {
        return Map.of("Authorization", "Bearer " + accessToken, "Content-Type", "application/json");
    }

    HttpResponse<String> post(String path, Map<String, String> headers, String body) throws Exception {
        return send("POST", path, headers, body);
    }

    HttpResponse<String> send(String method, String path, Map<String, String> headers, String body)
            throws IOException, InterruptedException {
        var response = app.send(method, path, headers, body);
        if (response.statusCode() == 204 || response.statusCode() >= 400) assertOmits(response, secrets);
        return response;
    }

    /** Requests were logged, and no tracked value reached the captured output. */
    void assertLogsOmitSecrets(CapturedOutput output) {
        assertThat(output.getAll()).contains("\"message\":\"HTTP response status=");
        assertOmits("captured output", output.getAll(), secrets);
    }

    String track(String secret) {
        assertThat(secret).hasSizeGreaterThanOrEqualTo(8);
        secrets.add(secret);
        return secret;
    }

    void verifyMobile(User user) throws SQLException {
        assertThat(database.update("UPDATE users SET mobile_verified = TRUE WHERE mobile = ?", user.mobile()))
                .isOne();
    }

    UUID userId(User user) throws SQLException {
        return database.single("SELECT id FROM users WHERE mobile = ?", UUID.class, user.mobile());
    }

    UUID sessionId(User user) throws SQLException {
        return database.single("SELECT s.id FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE u.mobile = ?",
                UUID.class, user.mobile());
    }

    long sessions(User user) throws SQLException {
        return database.single("SELECT count(*) FROM user_sessions s JOIN users u ON u.id = s.user_id "
                + "WHERE u.mobile = ?", Long.class, user.mobile());
    }

    long revoked(User user, RevocationReason reason) throws SQLException {
        return database.single("SELECT count(*) FROM user_sessions s JOIN users u ON u.id = s.user_id "
                + "WHERE u.mobile = ? AND s.revoked_at IS NOT NULL AND s.revoked_reason = ?",
                Long.class, user.mobile(), reason.code);
    }

    List<Generation> generations(User user) throws SQLException {
        return database.query("SELECT t.generation, t.consumed_at IS NOT NULL FROM user_session_refresh_tokens t "
                        + "JOIN user_sessions s ON s.id = t.session_id JOIN users u ON u.id = s.user_id "
                        + "WHERE u.mobile = ? ORDER BY s.created_at, t.generation",
                row -> new Generation(row.getLong(1), row.getBoolean(2)), user.mobile());
    }

    /**
     * Makes every transaction that changes a matching {@code table} row fail at commit, after the service has
     * returned, until the result is closed. The failure text is tracked, so it must never reach a response or log.
     */
    AutoCloseable failCommitsWhere(String table, String event, String condition) throws SQLException {
        String failure = track("synthetic-commit-failure-" + random(4));
        database.update("CREATE FUNCTION fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF " + condition
                + " THEN RAISE EXCEPTION '" + failure + "'; END IF; RETURN NEW; END $$");
        database.update("CREATE CONSTRAINT TRIGGER fail_commit AFTER " + event + " ON " + table
                + " DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_commit()");
        return () -> {
            database.update("DROP TRIGGER fail_commit ON " + table);
            database.update("DROP FUNCTION fail_commit()");
        };
    }

    /** Releases both requests at once and returns their responses in argument order. */
    static List<HttpResponse<String>> race(Callable<HttpResponse<String>> first,
                                           Callable<HttpResponse<String>> second) throws Exception {
        var start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = Stream.of(first, second).map(request -> executor.submit(() -> {
                start.await();
                return request.call();
            })).toList();
            start.countDown();
            return List.of(futures.get(0).get(20, TimeUnit.SECONDS), futures.get(1).get(20, TimeUnit.SECONDS));
        }
    }

    private static String random(int bytes) {
        byte[] value = new byte[bytes];
        RANDOM.nextBytes(value);
        return HexFormat.of().formatHex(value);
    }

    @Override
    public void close() throws SQLException {
        try {
            app.close();
        } finally {
            database.close();
        }
    }

    /** Resolves the one AuthApi that the auth integration tests of a run share; JUnit closes it when the run ends. */
    static final class Shared implements ParameterResolver {
        @Override
        public boolean supportsParameter(ParameterContext parameter, ExtensionContext context) {
            return parameter.getParameter().getType() == AuthApi.class;
        }

        @Override
        public Object resolveParameter(ParameterContext parameter, ExtensionContext context) {
            return context.getRoot().getStore(ExtensionContext.Namespace.create(AuthApi.class))
                    .computeIfAbsent(AuthApi.class, type -> start(), AuthApi.class);
        }
    }
}
