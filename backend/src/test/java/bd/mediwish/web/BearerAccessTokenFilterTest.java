package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.user.UserController;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.util.Set;
import java.util.UUID;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class BearerAccessTokenFilterTest {
    @Mock CurrentUserAuthentication currentUsers;
    private MockMvc mvc;

    @BeforeEach
    void setUp() throws Exception {
        var messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        var errors = new ApiErrors(messages, JsonMapper.builder().build());
        var securityRequest = new SecurityContextHolderAwareRequestFilter();
        securityRequest.afterPropertiesSet();
        mvc = MockMvcBuilders.standaloneSetup(new UserController(errors))
                .addFilters(new RequestCorrelationFilter(), new BearerAccessTokenFilter(currentUsers, errors),
                        securityRequest)
                .build();
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void verifiedBearerCreatesCurrentUserPrincipalAndProfileProjection() throws Exception {
        var current = new CurrentUserAuthentication.CurrentUser(
                UUID.randomUUID(), "alice_1", "01700000000", null, true, Set.of(UserRole.CUSTOMER));
        when(currentUsers.authenticate("access-token")).thenReturn(current);

        mvc.perform(get("/api/user/me").header("Authorization", "Bearer access-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("alice_1"))
                .andExpect(jsonPath("$.mobileVerified").value(true));
    }

    @Test
    void invalidBearerIsRejectedWithBearerChallengeAndBoundedError() throws Exception {
        when(currentUsers.authenticate("bad-token")).thenThrow(new AuthenticationRequiredException());

        mvc.perform(get("/api/user/me")
                        .header("Authorization", "Bearer bad-token")
                        .header("X-Request-ID", "bearer-01"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", "Bearer"))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId").value("bearer-01"));
    }

    @Test
    void BasicAndRefreshCookieValuesNeverBecomeProfileAuthentication() throws Exception {
        mvc.perform(get("/api/user/me")
                        .header("Authorization", "Basic YWxpY2U6cGFzc3dvcmQ="))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        mvc.perform(get("/api/user/me")
                        .cookie(new jakarta.servlet.http.Cookie(RefreshCookieAdapter.COOKIE_NAME, "opaque")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        verifyNoInteractions(currentUsers);
    }
}
