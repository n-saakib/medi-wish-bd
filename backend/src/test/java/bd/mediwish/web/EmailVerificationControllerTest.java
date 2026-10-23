package bd.mediwish.web;

import bd.mediwish.auth.*;
import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.user.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.Set;
import java.util.UUID;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** The protected adapter binds verification to the authenticated owner and never coerces codes. */
class EmailVerificationControllerTest {
    private static final String REQUEST = "/api/user/me/email-verification";
    private static final String CONFIRM = REQUEST + "/confirm";
    private final UUID owner = UUID.randomUUID();
    private final EmailVerificationService verification = mock(EmailVerificationService.class);
    private MockMvc mvc;

    @BeforeEach
    void start() {
        var current = new CurrentUser(owner, UUID.randomUUID(), new UserProfile("demo.user", "01700000000", null, false),
                Set.of(UserRole.CUSTOMER), MfaStatus.NOT_REQUIRED, Set.of("ROLE_CUSTOMER"));
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(current, null, java.util.List.of()));
        mvc = MockMvcBuilders.standaloneSetup(new EmailVerificationController(verification))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .setControllerAdvice(new ApiExceptionHandler(WebTestFixtures.apiErrors()),
                        new ProfileRequestAdvice(WebTestFixtures.apiErrors()))
                .addFilters(new RequestCorrelationFilter()).build();
    }

    @AfterEach
    void close() { SecurityContextHolder.clearContext(); }

    @Test
    void requestsNeedNoBodyAndIgnoreAnyBodyUnderTheSeparateFilterLimit() throws Exception {
        mvc.perform(post(REQUEST)).andExpect(status().isNoContent()).andExpect(content().string(""))
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(post(REQUEST).contentType(MediaType.TEXT_PLAIN).content("ignored"))
                .andExpect(status().isNoContent()).andExpect(content().string(""));
        verify(verification, times(2)).request(owner);
    }

    @Test
    void confirmationReturnsTheVerifiedProfileAndKeepsItsVersion() throws Exception {
        when(verification.confirm(owner, "123456")).thenReturn(new ProfileView("demo.user", null, "01700000000",
                false, null, "demo@example.test", true, null, AccountState.ACTIVE, 7));
        mvc.perform(post(CONFIRM).contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"123456\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.emailVerified").value(true))
                .andExpect(jsonPath("$.version").value(7)).andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(header().string("Cache-Control", "no-store"));
        verify(verification).confirm(owner, "123456");
    }

    @Test
    void invalidConfirmationShapesNeverEnterTheService() throws Exception {
        for (String body : new String[]{"{}", "[]", "null", "{", "{\"code\":null}", "{\"code\":123456}",
                "{\"code\":true}", "{\"code\":[]}", "{\"code\":{}}", "{\"code\":\"12345\"}",
                "{\"code\":\"1234567\"}", "{\"code\":\"１２３４５６\"}", "{\"code\":\"12345a\"}",
                "{\"code\":\"123456\",\"userId\":\"another\"}"}) {
            mvc.perform(post(CONFIRM).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
        mvc.perform(post(CONFIRM).contentType(MediaType.TEXT_PLAIN).content("123456"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(verification);
    }

    @Test
    void domainFailuresUseExistingBoundedEnvelopes() throws Exception {
        RuntimeException[] failures = {new CodeInvalidException(), new EmailRequiredException(),
                new AccountClosingException(), new TooManyAttemptsException(), new AuthenticationRequiredException()};
        int[] statuses = {400, 409, 409, 429, 401};
        String[] codes = {"CODE_INVALID", "EMAIL_REQUIRED", "ACCOUNT_CLOSING", "TOO_MANY_ATTEMPTS", "AUTHENTICATION_REQUIRED"};
        for (int i = 0; i < failures.length; i++) {
            doThrow(failures[i]).when(verification).confirm(owner, "123456");
            mvc.perform(post(CONFIRM).contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"123456\"}"))
                    .andExpect(status().is(statuses[i])).andExpect(jsonPath("$.code").value(codes[i]))
                    .andExpect(jsonPath("$.requestId").isNotEmpty())
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
    }
}
