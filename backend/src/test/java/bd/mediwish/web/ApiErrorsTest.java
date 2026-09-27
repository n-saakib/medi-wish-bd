package bd.mediwish.web;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletResponseWrapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

import static bd.mediwish.testsupport.TestApplication.UUID_PATTERN;
import static bd.mediwish.web.WebTestFixtures.apiErrors;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ApiErrorsTest {
    @Test
    void writesOnlyTheCodeEnglishMessageAndRequestId() throws Exception {
        var request = new MockHttpServletRequest();
        request.setAttribute("requestId", "request-123");
        request.setAttribute(RequestDispatcher.ERROR_EXCEPTION, new RuntimeException("PRIVATE_PASSWORD"));
        request.setQueryString("medicine=PRIVATE_SEARCH");
        var response = new MockHttpServletResponse();

        apiErrors().write(ApiError.AUTHENTICATION_REQUIRED, request, response);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentType()).isEqualTo("application/json");
        var mapper = JsonMapper.builder().build();
        assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("""
                {"code":"AUTHENTICATION_REQUIRED","message":"Authentication is required.","requestId":"request-123"}
                """));
    }

    /** Closing the stream would complete the response before outer filters, such as the status log, have run. */
    @Test
    void leavesTheResponseOpenForTheFiltersThatWrapIt() throws Exception {
        var response = new MockHttpServletResponse();
        var closed = new AtomicBoolean();
        var tracked = new HttpServletResponseWrapper(response) {
            @Override
            public ServletOutputStream getOutputStream() throws IOException {
                ServletOutputStream stream = super.getOutputStream();
                return new ServletOutputStream() {
                    @Override public void write(int b) throws IOException { stream.write(b); }
                    @Override public void write(byte[] b, int off, int len) throws IOException {
                        stream.write(b, off, len);
                    }
                    @Override public void close() { closed.set(true); }
                    @Override public boolean isReady() { return true; }
                    @Override public void setWriteListener(WriteListener listener) {}
                };
            }
        };

        apiErrors().write(ApiError.AUTHENTICATION_REQUIRED, new MockHttpServletRequest(), tracked);

        assertThat(response.getContentAsString()).contains("AUTHENTICATION_REQUIRED");
        assertThat(closed).as("the servlet output stream was closed").isFalse();
    }

    @ParameterizedTest
    @EnumSource(ApiError.class)
    void everyCodeHasAnExternalizedMessage(ApiError error) {
        assertThat(apiErrors().body(error, new MockHttpServletRequest()).message()).isNotBlank();
    }

    @ParameterizedTest
    @CsvSource({"400,INVALID_REQUEST", "401,AUTHENTICATION_REQUIRED", "403,ACCESS_DENIED", "404,NOT_FOUND",
            "405,METHOD_NOT_ALLOWED", "406,INVALID_REQUEST", "413,INVALID_REQUEST", "415,INVALID_REQUEST",
            "429,TOO_MANY_ATTEMPTS",
            "499,INVALID_REQUEST", "500,INTERNAL_ERROR", "503,INTERNAL_ERROR", "599,INTERNAL_ERROR"})
    void classifiesFrameworkStatuses(int status, ApiError expected) {
        assertThat(ApiError.forStatus(status)).isEqualTo(expected);
    }

    @ParameterizedTest
    @CsvSource({"404,404,NOT_FOUND", "415,415,INVALID_REQUEST", "500,500,INTERNAL_ERROR", "200,500,INTERNAL_ERROR"})
    void theErrorPageKeepsTheFrameworkStatusWithACorrelatedBoundedBody(int dispatched, int status, String code)
            throws Exception {
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new ApiErrorController(apiErrors()))
                .addFilters(new RequestCorrelationFilter()).build();

        var result = mvc.perform(get("/error")
                        .requestAttr(RequestDispatcher.ERROR_STATUS_CODE, dispatched)
                        .requestAttr(RequestDispatcher.ERROR_EXCEPTION, new IllegalStateException("PRIVATE_DETAIL"))
                        .with(request -> {
                            // MockMvc's builder has no dispatcher-type selector.
                            request.setDispatcherType(DispatcherType.ERROR);
                            return request;
                        }))
                .andExpect(status().is(status))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.requestId", matchesPattern(UUID_PATTERN)))
                .andReturn();

        assertThat(result.getResponse().getContentAsString())
                .contains(result.getResponse().getHeader("X-Request-ID"))
                .doesNotContain("PRIVATE_DETAIL", "exception");
    }
}
