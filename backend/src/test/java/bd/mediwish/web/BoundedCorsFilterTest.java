package bd.mediwish.web;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static bd.mediwish.web.WebTestFixtures.apiErrors;
import static bd.mediwish.web.WebTestFixtures.securityConfiguration;
import static org.assertj.core.api.Assertions.assertThat;

class BoundedCorsFilterTest {
    private static final String ALLOWED = "http://127.0.0.1:3000";

    private final BoundedCorsFilter filter = new BoundedCorsFilter(
            securityConfiguration(false, "test").corsConfigurationSource(ALLOWED), apiErrors());
    private final MockHttpServletResponse response = new MockHttpServletResponse();
    private final MockFilterChain chain = new MockFilterChain();

    @Test
    void aDisallowedOriginGetsTheBoundedAccessDeniedEnvelopeInsteadOfSpringText() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/user/me");
        request.addHeader("Origin", "https://evil.example.test");

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("ACCESS_DENIED").doesNotContain("Invalid CORS request");
        assertThat(response.getHeader("Access-Control-Allow-Origin")).isNull();
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void anAllowedOriginContinuesWithCredentialedCorsHeaders() throws Exception {
        var request = new MockHttpServletRequest("POST", "/api/auth/refresh");
        request.addHeader("Origin", ALLOWED);

        filter.doFilter(request, response, chain);

        assertThat(response.getHeader("Access-Control-Allow-Origin")).isEqualTo(ALLOWED);
        assertThat(response.getHeader("Access-Control-Allow-Credentials")).isEqualTo("true");
        assertThat(chain.getRequest()).isSameAs(request);
    }

    @Test
    void anAllowedPreflightIsAnsweredWithoutReachingTheApplication() throws Exception {
        var request = new MockHttpServletRequest("OPTIONS", "/api/auth/refresh");
        request.addHeader("Origin", ALLOWED);
        request.addHeader("Access-Control-Request-Method", "POST");
        request.addHeader("Access-Control-Request-Headers", "X-XSRF-TOKEN");

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Access-Control-Allow-Headers")).isEqualTo("X-XSRF-TOKEN");
        assertThat(chain.getRequest()).isNull();
    }
}
