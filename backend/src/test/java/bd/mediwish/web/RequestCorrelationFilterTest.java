package bd.mediwish.web;

import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class RequestCorrelationFilterTest {
    @Test void acceptsBoundedIdsAndClearsRequestContext() throws Exception {
        var request = new MockHttpServletRequest();
        request.addHeader("X-Request-ID", "checkout-123_OK");
        var response = new MockHttpServletResponse();
        new RequestCorrelationFilter().doFilter(request, response, (req, res) ->
                assertThat(MDC.get("requestId")).isEqualTo("checkout-123_OK"));
        assertThat(response.getHeader("X-Request-ID")).isEqualTo("checkout-123_OK");
        assertThat(MDC.get("requestId")).isNull();
    }

    @Test void replacesMissingDuplicateAndUnsafeIds() throws Exception {
        for (String value : new String[]{"", "x".repeat(65), "unsafe\r\nheader", "বাংলা", "duplicate"}) {
            var request = new MockHttpServletRequest();
            request.addHeader("X-Request-ID", value);
            if (value.equals("duplicate")) request.addHeader("X-Request-ID", "another");
            var response = new MockHttpServletResponse();
            new RequestCorrelationFilter().doFilter(request, response, (req, res) -> {});
            assertThat(response.getHeader("X-Request-ID")).matches("[A-Za-z0-9_-]{1,64}").isNotEqualTo(value);
        }
    }
}
