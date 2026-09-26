package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.TransactionSystemException;

import java.util.Set;

import static bd.mediwish.web.WebTestFixtures.apiErrors;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BearerAccessTokenFilterTest {
    @Mock CurrentUserAuthentication currentUsers;
    private BearerAccessTokenFilter filter;
    private final MockHttpServletResponse response = new MockHttpServletResponse();
    private final MockFilterChain chain = new MockFilterChain();

    @BeforeEach
    void setUp() {
        filter = new BearerAccessTokenFilter(SecurityConfiguration.PROTECTED_ROUTES, currentUsers, apiErrors());
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void aVerifiedBearerAuthenticatesTheCurrentProfileWithItsPersistedRoles() throws Exception {
        var current = new CurrentUser(new UserProfile("alice_1", "01700000000", null, true), Set.of(UserRole.CUSTOMER));
        when(currentUsers.authenticate("access-token")).thenReturn(current);

        filter.doFilter(profileRequest("bearer access-token"), response, chain);

        var authentication = SecurityContextHolder.getContext().getAuthentication();
        assertThat(authentication.getPrincipal()).isSameAs(current.profile());
        assertThat(authentication.getAuthorities()).extracting(Object::toString).containsExactly("ROLE_CUSTOMER");
        assertThat(chain.getRequest()).isNotNull();
    }

    @Test
    void anInvalidBearerIsRejectedWithABearerChallenge() throws Exception {
        when(currentUsers.authenticate("bad-token")).thenThrow(new AuthenticationRequiredException());

        filter.doFilter(profileRequest("Bearer bad-token"), response, chain);

        assertRejected();
    }

    @Test
    void severalAuthorizationValuesAreRejectedBeforeVerification() throws Exception {
        filter.doFilter(profileRequest("Bearer one", "Bearer two"), response, chain);

        assertRejected();
        verifyNoInteractions(currentUsers);
    }

    @Test
    void aMissingOrNonBearerAuthorizationContinuesUnauthenticated() throws Exception {
        for (var request : new MockHttpServletRequest[]{profileRequest(), profileRequest("Basic YWxpY2U6cGFzc3dvcmQ=")}) {
            var continued = new MockFilterChain();
            filter.doFilter(request, response, continued);

            assertThat(continued.getRequest()).isNotNull();
        }
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verifyNoInteractions(currentUsers);
    }

    /** The API client cannot send Proxy-Authorization, so it is proved here; the profile IT covers the rest end to end. */
    @Test
    void aTokenOutsideTheAuthorizationHeaderIsNeverRead() throws Exception {
        var request = profileRequest();
        request.addHeader("Proxy-Authorization", "Bearer access-token");
        request.addHeader("X-Auth-Token", "access-token");
        request.setCookies(new jakarta.servlet.http.Cookie("access_token", "access-token"));
        request.setParameter("access_token", "access-token");
        request.setParameter("token", "access-token");

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verifyNoInteractions(currentUsers);
    }

    @Test
    void publicRoutesNeverReadTheBearer() throws Exception {
        var request = new MockHttpServletRequest("POST", "/api/auth/login");
        request.addHeader("Authorization", "Bearer anything");

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        verifyNoInteractions(currentUsers);
    }

    @Test
    void aPersistenceFailureIsABoundedInternalError() throws Exception {
        for (RuntimeException failure : new RuntimeException[]{
                new DataAccessResourceFailureException("PRIVATE_DETAIL"), new TransactionSystemException("PRIVATE_DETAIL")}) {
            doThrow(failure).when(currentUsers).authenticate("access-token");
            var failed = new MockHttpServletResponse();

            filter.doFilter(profileRequest("Bearer access-token"), failed, chain);

            assertThat(failed.getStatus()).isEqualTo(500);
            assertThat(failed.getContentAsString()).contains("INTERNAL_ERROR").doesNotContain("PRIVATE_DETAIL");
        }
        assertThat(chain.getRequest()).isNull();
    }

    private static MockHttpServletRequest profileRequest(String... authorization) {
        var request = new MockHttpServletRequest("GET", "/api/user/me");
        for (String value : authorization) request.addHeader("Authorization", value);
        return request;
    }

    private void assertRejected() throws Exception {
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getHeader("WWW-Authenticate")).isEqualTo("Bearer");
        assertThat(response.getContentAsString()).contains("AUTHENTICATION_REQUIRED");
        assertThat(chain.getRequest()).isNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }
}
