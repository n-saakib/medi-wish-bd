package bd.mediwish.web;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.MDC;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RequestCorrelationFilterTest {
    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void defersLogUntilErrorDispatchAndReusesRequestId(CapturedOutput output) throws Exception {
        var filter = new RequestCorrelationFilter();
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        assertThatThrownBy(() -> filter.doFilter(request, response,
                (req, res) -> { throw new ServletException("synthetic failure"); }))
                .isInstanceOf(ServletException.class);

        String requestId = response.getHeader("X-Request-ID");
        assertThat(requestId).isNotBlank();
        assertThat(output.getAll()).doesNotContain("HTTP response status=");
        assertThat(MDC.get("requestId")).isNull();

        request.setDispatcherType(DispatcherType.ERROR);
        request.setAttribute(RequestDispatcher.ERROR_STATUS_CODE, 500);
        response.setStatus(500);
        filter.doFilter(request, response, (req, res) ->
                assertThat(MDC.get("requestId")).isEqualTo(requestId));

        assertThat(request.getAttribute("requestId")).isEqualTo(requestId);
        assertThat(response.getHeader("X-Request-ID")).isEqualTo(requestId);
        assertThat(output.getAll())
                .containsOnlyOnce("HTTP response status=500")
                .doesNotContain("HTTP response status=200");
        assertThat(MDC.get("requestId")).isNull();
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void nestedErrorDispatchLogsOneFinalStatus(CapturedOutput output) throws Exception {
        var filter = new RequestCorrelationFilter();
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, res) -> {
            String requestId = response.getHeader("X-Request-ID");
            request.setDispatcherType(DispatcherType.ERROR);
            request.setAttribute(RequestDispatcher.ERROR_STATUS_CODE, 500);
            response.setStatus(500);

            filter.doFilter(request, response, (errorRequest, errorResponse) -> {
                assertThat(MDC.get("requestId")).isEqualTo(requestId);
            });
        });

        assertThat(output.getAll())
                .containsOnlyOnce("HTTP response status=500")
                .doesNotContain("HTTP response status=200");
    }

    @Test void replacesCallerSuppliedIdAndClearsRequestContext() throws Exception {
        var request = new MockHttpServletRequest();
        request.addHeader("X-Request-ID", "checkout-123_OK");
        var response = new MockHttpServletResponse();
        new RequestCorrelationFilter().doFilter(request, response, (req, res) -> {
            String mdcId = MDC.get("requestId");
            assertThat(mdcId)
                    .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                    .isNotEqualTo("checkout-123_OK");
            assertThat(mdcId).isEqualTo(req.getAttribute("requestId")).isEqualTo(response.getHeader("X-Request-ID"));
        });
        assertThat(request.getAttribute("requestId")).isEqualTo(response.getHeader("X-Request-ID"));
        assertThat(response.getHeader("X-Request-ID"))
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                .isNotEqualTo("checkout-123_OK");
        assertThat(MDC.get("requestId")).isNull();
    }

    @Test void replacesMissingDuplicateAndUnsafeIds() throws Exception {
        var missingResponse = new MockHttpServletResponse();
        new RequestCorrelationFilter().doFilter(new MockHttpServletRequest(), missingResponse, (req, res) -> {});
        assertThat(missingResponse.getHeader("X-Request-ID"))
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

        for (String value : new String[]{"", "x".repeat(65), "unsafe\r\nheader", "বাংলা", "duplicate"}) {
            var request = new MockHttpServletRequest();
            request.addHeader("X-Request-ID", value);
            if (value.equals("duplicate")) request.addHeader("X-Request-ID", "another");
            var response = new MockHttpServletResponse();
            new RequestCorrelationFilter().doFilter(request, response, (req, res) -> {});
            assertThat(response.getHeader("X-Request-ID"))
                    .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                    .isNotEqualTo(value);
        }
    }
}
