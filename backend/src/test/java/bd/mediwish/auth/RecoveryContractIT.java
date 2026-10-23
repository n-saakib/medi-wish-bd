package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
import org.junit.jupiter.api.*;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.*;
import static org.assertj.core.api.Assertions.*;

/** Exact JSON contracts, bounded errors, public cookie isolation and the credential body-size boundary. */
@Tag("integration")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RecoveryContractIT {
    private final AuthApi api = AuthApi.start();
    @AfterAll void close() throws Exception { api.close(); }

    @Test
    void theProfileHasTheDeclaredFieldOrderAndNoCredentialFields() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        var response = api.profileOf(token);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json(response).keySet()).containsExactly("username", "fullName", "mobile", "mobileVerified",
                "pendingMobile", "email", "emailVerified", "dateOfBirth", "accountState", "version");
    }

    @Test
    void jsonRoutesRejectWrongMediaExtraFieldsAndOneByteOverTheBodyCap() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        String unknown = api.track("contract." + UUID.randomUUID() + "@example.test");
        var json = AuthApi.JSON_CONTENT;
        var bearer = Map.of("Authorization", "Bearer " + token, "Content-Type", "application/json");
        var routes = List.of(
                new JsonRoute("/api/auth/password-reset/request", "{\"email\":\"" + unknown + "\"}", json, 202),
                new JsonRoute("/api/auth/password-reset/confirm", "{\"email\":\"" + unknown
                        + "\",\"code\":\"123456\",\"newPassword\":\"contract-new\"}", json, 400),
                new JsonRoute("/api/user/me/email-verification/confirm", "{\"code\":\"123456\"}", bearer, 400));
        for (var route : routes) {
            var plain = new java.util.HashMap<>(route.headers());
            plain.put("Content-Type", "text/plain");
            assertError(api.post(route.path(), plain, route.body()), 400, "INVALID_REQUEST");
            assertError(api.post(route.path(), route.headers(), padded(route.body(), 16 * 1024 + 1)),
                    400, "INVALID_REQUEST");
            String extra = route.body().substring(0, route.body().length() - 1) + ",\"userId\":\""
                    + UUID.randomUUID() + "\"}";
            assertError(api.post(route.path(), route.headers(), extra), 400, "INVALID_REQUEST");
            var boundary = api.post(route.path(), route.headers(), padded(route.body(), 16 * 1024));
            assertThat(boundary.statusCode()).isEqualTo(route.boundaryStatus());
            if (route.boundaryStatus() == 400) assertError(boundary, 400, "CODE_INVALID");
            else assertThat(boundary.body()).isEmpty();
            if (route.path().startsWith("/api/auth/")) assertThat(boundary.headers().allValues("Set-Cookie")).isEmpty();
        }
        assertError(api.post("/api/auth/password-reset/request", json,
                "{\"email\":\"" + unknown + "\",\"role\":\"ADMIN\"}"), 400, "INVALID_REQUEST");
    }

    @Test
    void verificationRequestIgnoresABoundedBodyAndNeedsOnlyTheBearerToken() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        var response = api.post("/api/user/me/email-verification",
                Map.of("Authorization", "Bearer " + token, "Content-Type", "text/plain"), "ignored body");
        assertThat(response.statusCode()).isEqualTo(204);
        assertThat(response.body()).isEmpty();
        api.awaitMail(EmailKind.EMAIL_VERIFICATION_CODE, user.email());
    }

    private record JsonRoute(String path, String body, Map<String, String> headers, int boundaryStatus) {}
    private static String padded(String body, int bytes) {
        int padding = bytes - body.getBytes(StandardCharsets.UTF_8).length;
        return "{" + " ".repeat(padding) + body.substring(1);
    }
}
