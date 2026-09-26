package bd.mediwish.testsupport;

import tools.jackson.databind.json.JsonMapper;

import java.net.http.HttpResponse;
import java.util.Collection;
import java.util.Map;
import java.util.ResourceBundle;

import static org.assertj.core.api.Assertions.assertThat;

/** Assertions on the API error envelope and on values that must never leave the server. */
public final class ApiAssertions {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final ResourceBundle MESSAGES = ResourceBundle.getBundle("messages");

    private ApiAssertions() {}

    @SuppressWarnings("unchecked")
    public static Map<String, Object> json(HttpResponse<String> response) {
        return JSON.readValue(response.body(), Map.class);
    }

    /** The bounded envelope: exactly code, its externalized message and the response's request ID. */
    public static void assertError(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.headers().firstValue("Content-Type")).hasValueSatisfying(type ->
                assertThat(type).startsWith("application/json"));
        assertThat(response.body()).hasSizeLessThan(512);
        assertThat(json(response)).containsExactlyInAnyOrderEntriesOf(Map.of(
                "code", code,
                "message", MESSAGES.getString("error." + code),
                "requestId", response.headers().firstValue("X-Request-ID").orElseThrow()));
    }

    /** Fails when any secret appears in the response body or any response header. */
    public static void assertOmits(HttpResponse<String> response, Collection<String> secrets) {
        assertOmits("response", response.body() + response.headers().map(), secrets);
    }

    /** Fails when any secret appears in the text, naming only where it appeared, never the value. */
    public static void assertOmits(String where, String text, Collection<String> secrets) {
        for (String secret : secrets) {
            assertThat(text.contains(secret)).as("a tracked secret appeared in the %s", where).isFalse();
        }
    }
}
