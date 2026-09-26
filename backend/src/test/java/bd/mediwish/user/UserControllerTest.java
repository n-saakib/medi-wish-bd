package bd.mediwish.user;

import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.web.ApiErrors;
import bd.mediwish.web.RequestCorrelationFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class UserControllerTest {
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        var messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        var errors = new ApiErrors(messages, JsonMapper.builder().build());
        mvc = MockMvcBuilders.standaloneSetup(new UserController(errors))
                .addFilters(new RequestCorrelationFilter()).build();
    }

    @Test
    void profileUsesTheCurrentUserPrincipalInsteadOfASecondRepositoryLookup() throws Exception {
        var current = new CurrentUserAuthentication.CurrentUser(
                UUID.randomUUID(), "alice_1", "01700000000", "alice@example.com", true,
                java.util.Set.of(UserRole.CUSTOMER));
        var authentication = new UsernamePasswordAuthenticationToken(current, null,
                List.of(new SimpleGrantedAuthority("ROLE_CUSTOMER")));

        mvc.perform(get("/api/user/me")
                        .principal(authentication)
                        .header("X-Request-ID", "profile-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("alice_1"))
                .andExpect(jsonPath("$.mobileVerified").value(true))
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.roles").doesNotExist());
    }

    @Test
    void missingCurrentPrincipalUsesTheBoundedAuthenticationError() throws Exception {
        mvc.perform(get("/api/user/me").header("X-Request-ID", "profile-02"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId").value(
                        matchesPattern("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")))
                .andExpect(jsonPath("$.password").doesNotExist());
    }
}
