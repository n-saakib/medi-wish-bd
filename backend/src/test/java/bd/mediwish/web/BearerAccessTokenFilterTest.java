package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.user.UserController;
import bd.mediwish.user.UserRole;
import jakarta.persistence.PersistenceException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.TransactionSystemException;
import tools.jackson.databind.json.JsonMapper;

import java.util.Set;
import java.util.UUID;

import static org.hamcrest.Matchers.matchesPattern;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
                .andExpect(jsonPath("$.requestId").value(
                        matchesPattern("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")));
    }

    @Test
    void databaseFailureDuringCurrentUserLookupReturnsBoundedInternalError() throws Exception {
        assertCurrentUserFailureReturnsBoundedInternalError(
                new DataAccessResourceFailureException("private database detail"));
    }

    @Test
    void transactionFailureDuringCurrentUserLookupReturnsBoundedInternalError() throws Exception {
        assertCurrentUserFailureReturnsBoundedInternalError(
                new TransactionSystemException("private transaction detail"));
    }

    @Test
    void persistenceFailureDuringCurrentUserLookupReturnsBoundedInternalError() throws Exception {
        assertCurrentUserFailureReturnsBoundedInternalError(
                new PersistenceException("private persistence detail"));
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

    @Test
    void queryParametersAndUnrelatedAccessTokenHeadersCannotAuthenticateProfile() throws Exception {
        mvc.perform(get("/api/user/me").param("access_token", "synthetic-query-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        mvc.perform(get("/api/user/me").header("X-Access-Token", "synthetic-header-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        verifyNoInteractions(currentUsers);
    }

    @Test
    void unrelatedBearerOnPublicRouteDoesNotInvokeCurrentUserAuthentication() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .header("Authorization", "Bearer " + "x".repeat(4097)))
                .andExpect(status().isNotFound());

        verifyNoInteractions(currentUsers);
    }

    private void assertCurrentUserFailureReturnsBoundedInternalError(RuntimeException failure) throws Exception {
        when(currentUsers.authenticate("access-token")).thenThrow(failure);

        mvc.perform(get("/api/user/me").header("Authorization", "Bearer access-token"))
                .andExpect(status().isInternalServerError())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.message").value("The request could not be completed."))
                .andExpect(jsonPath("$.requestId", matchesPattern(
                        "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")));
    }
}
