package bd.mediwish.web;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import java.nio.charset.StandardCharsets;
import static org.assertj.core.api.Assertions.assertThat;

/** Profile commands share the 16 KiB JSON guard, while bodyless cancellation is allowed. */
class ProfileBodyLimitTest {
    @Test
    void exactlyTheLimitPassesAndOneByteOverIsRejectedForBothJsonCommands() throws Exception {
        var filter = new AuthRequestBodyLimitFilter(SecurityConfiguration.BEARER_COMMAND_ROUTES, WebTestFixtures.apiErrors());
        for (String[] route : new String[][]{{"PUT", "/api/user/me/profile"}, {"POST", "/api/user/me/mobile-change"}}) {
            for (int size : new int[]{16 * 1024, 16 * 1024 + 1}) {
                var request = new MockHttpServletRequest(route[0], route[1]);
                request.setContentType("application/json");
                request.setContent(("{}" + " ".repeat(size - 2)).getBytes(StandardCharsets.UTF_8));
                var response = new MockHttpServletResponse();
                var chain = new MockFilterChain();
                filter.doFilter(request, response, chain);
                if (size == 16 * 1024) {
                    assertThat(chain.getRequest().getInputStream().readAllBytes()).hasSize(size);
                } else {
                    assertThat(chain.getRequest()).isNull();
                    assertThat(response.getStatus()).isEqualTo(400);
                    assertThat(response.getContentAsString()).contains("INVALID_REQUEST");
                }
            }
        }
    }

    @Test
    void bodylessDeletePassesWithoutAContentType() throws Exception {
        var request = new MockHttpServletRequest("DELETE", "/api/user/me/mobile-change");
        var chain = new MockFilterChain();
        new AuthRequestBodyLimitFilter(SecurityConfiguration.BEARER_COMMAND_ROUTES, WebTestFixtures.apiErrors())
                .doFilter(request, new MockHttpServletResponse(), chain);
        assertThat(chain.getRequest()).isSameAs(request);
    }
}
