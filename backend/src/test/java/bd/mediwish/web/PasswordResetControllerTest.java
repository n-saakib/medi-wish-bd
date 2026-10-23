package bd.mediwish.web;

import bd.mediwish.auth.CodeInvalidException;
import bd.mediwish.auth.PasswordResetController;
import bd.mediwish.auth.PasswordResetService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Public recovery commands keep strict wire types, generic request answers and bounded errors. */
class PasswordResetControllerTest {
    private static final String REQUEST = "/api/auth/password-reset/request";
    private static final String CONFIRM = "/api/auth/password-reset/confirm";
    private final PasswordResetService resets = mock(PasswordResetService.class);
    private MockMvc mvc;

    @BeforeEach
    void start() {
        mvc = MockMvcBuilders.standaloneSetup(new PasswordResetController(resets))
                .setControllerAdvice(new ApiExceptionHandler(WebTestFixtures.apiErrors()),
                        new ProfileRequestAdvice(WebTestFixtures.apiErrors()))
                .addFilters(new RequestCorrelationFilter()).build();
    }

    @Test
    void requestsAreNormalizedAndAlwaysReturnAnEmptyAcceptedAnswerWithoutCookies() throws Exception {
        for (String email : new String[]{" Demo.Reset@Example.Test ", "unknown@example.test"}) {
            mvc.perform(post(REQUEST).contentType(MediaType.APPLICATION_JSON)
                            .header("Authorization", "Bearer deliberately-irrelevant")
                            .content("{\"email\":\"" + email + "\"}"))
                    .andExpect(status().isAccepted()).andExpect(content().string(""))
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(header().doesNotExist("Set-Cookie"));
        }
        verify(resets).request("demo.reset@example.test");
        verify(resets).request("unknown@example.test");
    }

    @Test
    void invalidRequestBodiesNeverReachTheService() throws Exception {
        for (String body : new String[]{"{}", "[]", "null", "{", "{\"email\":null}",
                "{\"email\":1}", "{\"email\":true}", "{\"email\":[]}", "{\"email\":{}}",
                "{\"email\":\"\"}", "{\"email\":\"not-an-email\"}",
                "{\"email\":\"" + "a".repeat(321) + "\"}",
                "{\"email\":\"demo@example.test\",\"code\":\"123456\"}"}) {
            invalid(REQUEST, body);
        }
        verifyNoInteractions(resets);
    }

    @Test
    void confirmationPreservesPasswordWhitespaceAndReturnsNoSession() throws Exception {
        mvc.perform(post(CONFIRM).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\" Demo@Example.Test \",\"code\":\"123456\",\"newPassword\":\" secret \"}"))
                .andExpect(status().isNoContent()).andExpect(content().string(""))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().doesNotExist("Set-Cookie"));
        verify(resets).confirm("demo@example.test", "123456", " secret ");
    }

    @Test
    void confirmationRejectsCoercionWrongCodeShapesAndPasswordsOutsideA5() throws Exception {
        String valid = "{\"email\":\"demo@example.test\",\"code\":\"123456\",\"newPassword\":\"secret\"}";
        for (String field : new String[]{"email", "code", "newPassword"}) {
            String value = switch (field) { case "email" -> "demo@example.test"; case "code" -> "123456"; default -> "secret"; };
            for (String replacement : new String[]{"null", "1", "true", "[]", "{}"}) {
                invalid(CONFIRM, valid.replace("\"" + field + "\":\"" + value + "\"", "\"" + field + "\":" + replacement));
            }
        }
        for (String code : new String[]{"12345", "1234567", "12a456", "１２３４５６", "12345 "}) {
            invalid(CONFIRM, valid.replace("123456", code));
        }
        for (String password : new String[]{"12345", "p".repeat(31), "      "}) {
            invalid(CONFIRM, valid.replace("secret", password));
        }
        for (String body : new String[]{"{}", "[]", valid.replace(",\"newPassword\":\"secret\"", ""),
                valid.replace("}", ",\"extra\":true}")}) invalid(CONFIRM, body);
        verifyNoInteractions(resets);
    }

    @Test
    void invalidCodesAndNonJsonHaveBoundedErrorsAndNoStore() throws Exception {
        doThrow(new CodeInvalidException()).when(resets).confirm(anyString(), anyString(), anyString());
        mvc.perform(post(CONFIRM).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"demo@example.test\",\"code\":\"123456\",\"newPassword\":\"secret\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CODE_INVALID"))
                .andExpect(jsonPath("$.requestId").isNotEmpty())
                .andExpect(header().string("Cache-Control", "no-store"));
        clearInvocations(resets);
        for (String path : new String[]{REQUEST, CONFIRM}) {
            mvc.perform(post(path).contentType(MediaType.TEXT_PLAIN).content("{}"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
        verifyNoInteractions(resets);
    }

    private void invalid(String path, String body) throws Exception {
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.requestId").isNotEmpty())
                .andExpect(header().string("Cache-Control", "no-store"));
    }
}
