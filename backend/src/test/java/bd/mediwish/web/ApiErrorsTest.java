package bd.mediwish.web;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.RequestDispatcher;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ApiErrorsTest {
    @Test void emitsOnlyThePublicErrorContractInEnglish() throws Exception {
        var messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        var mapper = JsonMapper.builder().build();
        var errors = new ApiErrors(messages, mapper);
        var request = new MockHttpServletRequest();
        request.setAttribute("requestId", "request-123");
        request.setAttribute("jakarta.servlet.error.exception", new RuntimeException("PRIVATE_PASSWORD"));
        request.setQueryString("medicine=PRIVATE_SEARCH");
        var response = new MockHttpServletResponse();

        errors.write(401, request, response);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("""
                {"code":"AUTHENTICATION_REQUIRED","message":"Authentication is required.","requestId":"request-123"}
                """));
        assertThat(response.getContentAsString()).doesNotContain("PRIVATE", "exception", "medicine");
        assertThat(errors.body(599, request).code()).isEqualTo("INTERNAL_ERROR");
        assertThat(errors.body(403, request).message()).isEqualTo("Access is denied.");
    }

    @Test
    void errorDispatchMapsNotFoundAndServerFailuresToCorrelatedPublicErrors() throws Exception {
        var messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        var mvc = MockMvcBuilders.standaloneSetup(new ApiErrorController(
                new ApiErrors(messages, JsonMapper.builder().build())))
                .addFilters(new RequestCorrelationFilter())
                .build();

        assertErrorDispatch(mvc, 404, "NOT_FOUND", "The requested resource was not found.");
        assertErrorDispatch(mvc, 500, "INTERNAL_ERROR", "The request could not be completed.");
    }

    @SuppressWarnings("deprecation")
    private static void assertErrorDispatch(MockMvc mvc, int expectedStatus, String code, String message) throws Exception {
        var result = mvc.perform(get("/error")
                        .requestAttr(RequestDispatcher.ERROR_STATUS_CODE, expectedStatus)
                        .requestAttr(RequestDispatcher.ERROR_EXCEPTION, new IllegalStateException("PRIVATE_DETAIL"))
                        .with(request -> {
                            // MockMvc's builder has no dispatcher-type selector.
                            request.setDispatcherType(DispatcherType.ERROR);
                            return request;
                        }))
                .andExpect(status().is(expectedStatus))
                .andExpect(header().exists("X-Request-ID"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.message").value(message))
                .andExpect(jsonPath("$.requestId", matchesPattern(
                        "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")))
                .andReturn();

        assertThat(result.getResponse().getContentAsString()).doesNotContain("PRIVATE_DETAIL", "exception");
        assertThat(result.getResponse().getHeader("X-Request-ID"))
                .isEqualTo(JsonMapper.builder().build().readTree(result.getResponse().getContentAsString())
                        .get("requestId").asText());
    }
}
