package bd.mediwish.web;

import jakarta.servlet.http.HttpServletRequestWrapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;

import static bd.mediwish.web.WebTestFixtures.apiErrors;
import static org.assertj.core.api.Assertions.assertThat;

class AuthRequestBodyLimitFilterTest {
    private static final int LIMIT = AuthRequestBodyLimitFilter.MAX_BODY_BYTES;

    private final AuthRequestBodyLimitFilter filter = new AuthRequestBodyLimitFilter(SecurityConfiguration.CREDENTIAL_ROUTES, apiErrors());
    private final MockHttpServletResponse response = new MockHttpServletResponse();
    private final MockFilterChain chain = new MockFilterChain();

    @ParameterizedTest
    @CsvSource({"/api/auth/login,application/json", "/api/auth/register,application/json;charset=UTF-8",
            "/api/auth/login,application/vnd.mediwish+json"})
    void aBodyAtTheLimitReachesTheControllerIntact(String path, String contentType) throws Exception {
        byte[] body = "x".repeat(LIMIT).getBytes(StandardCharsets.UTF_8);

        filter.doFilter(request(path, contentType, body), response, chain);

        assertThat(chain.getRequest().getInputStream().readAllBytes()).isEqualTo(body);
        assertThat(chain.getRequest().getContentLengthLong()).isEqualTo(LIMIT);
    }

    @ParameterizedTest
    @ValueSource(longs = {-1, 1, LIMIT + 1})
    void aJsonBodyOverTheLimitIsRejectedWhateverContentLengthDeclares(long declaredLength) throws Exception {
        var original = request("/api/auth/login", "application/json", "x".repeat(LIMIT + 1).getBytes(StandardCharsets.UTF_8));
        var request = new HttpServletRequestWrapper(original) {
            @Override
            public long getContentLengthLong() {
                return declaredLength;
            }
        };

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(response.getContentAsString()).contains("INVALID_REQUEST").doesNotContain("xxx");
        assertThat(chain.getRequest()).isNull();
    }

    @ParameterizedTest
    @CsvSource({"POST,/api/auth/login,text/plain", "POST,/api/auth/register,", "POST,/api/auth/refresh,application/json",
            "GET,/api/auth/login,application/json"})
    void otherRequestsPassThroughToTheirNormalHandling(String method, String path, String contentType) throws Exception {
        var request = request(path, contentType, "x".repeat(LIMIT + 1).getBytes(StandardCharsets.UTF_8));
        request.setMethod(method);

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isSameAs(request);
    }

    private static MockHttpServletRequest request(String path, String contentType, byte[] body) {
        var request = new MockHttpServletRequest("POST", path);
        request.setContentType(contentType);
        request.setContent(body);
        return request;
    }
}
