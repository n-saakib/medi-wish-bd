package bd.mediwish.web;

import org.junit.jupiter.api.Test;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

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
}
