package bd.mediwish.web;

import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.user.UserController;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class Ticket03SecurityBoundaryTest {
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
    void multipleAuthorizationValuesAreRejectedBeforeVerification() throws Exception {
        mvc.perform(get("/api/user/me")
                        .header("Authorization", "Bearer synthetic-one", "Bearer synthetic-two")
                        .header("X-Request-ID", "boundary-multiple"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", "Bearer"))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId").value("boundary-multiple"));

        verifyNoInteractions(currentUsers);
    }

    @Test
    void malformedAndOversizedBearerValuesUseTheBoundedErrorShape() throws Exception {
        mvc.perform(get("/api/user/me")
                        .header("Authorization", "Bearer")
                        .header("X-Request-ID", "boundary-malformed"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId").value("boundary-malformed"));

        String oversized = "Bearer " + "x".repeat(4097);
        mvc.perform(get("/api/user/me")
                        .header("Authorization", oversized)
                        .header("X-Request-ID", "boundary-oversized"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", "Bearer"))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId").value("boundary-oversized"));

        verifyNoInteractions(currentUsers);
    }

    @Test
    void hostedRefreshCookieIsSecureScopedAndClearsWithTheSameBoundary() {
        var cookies = new RefreshCookieAdapter(Duration.ofDays(30), true);
        var setResponse = new MockHttpServletResponse();

        cookies.set(setResponse, "synthetic-refresh");

        assertThat(setResponse.getHeader("Set-Cookie"))
                .contains("MW_REFRESH=synthetic-refresh", "Path=/api/auth", "Max-Age=2592000",
                        "Secure", "HttpOnly", "SameSite=Lax")
                .doesNotContain("Domain=");

        var clearResponse = new MockHttpServletResponse();
        cookies.clear(clearResponse);

        assertThat(clearResponse.getHeader("Set-Cookie"))
                .contains("MW_REFRESH=", "Path=/api/auth", "Max-Age=0", "Secure", "HttpOnly", "SameSite=Lax");
    }

    @Test
    void oversizedRefreshCookieIsIgnoredAtTheWebBoundary() {
        var request = new MockHttpServletRequest("POST", "/api/auth/refresh");
        request.setCookies(new Cookie(RefreshCookieAdapter.COOKIE_NAME,
                "x".repeat(RefreshCookieAdapter.MAX_COOKIE_VALUE_LENGTH + 1)));

        assertThat(new RefreshCookieAdapter(Duration.ofDays(30), false).read(request)).isEmpty();
    }

    @Test
    void hostedCsrfCookieIsSecureNonHttpOnlyAndApiScoped() {
        CookieCsrfTokenRepository repository = new SecurityConfiguration().csrfTokenRepository(true);
        var request = new MockHttpServletRequest("GET", "/api/auth/csrf");
        var response = new MockHttpServletResponse();

        repository.saveToken(repository.generateToken(request), request, response);

        var cookie = response.getCookie("XSRF-TOKEN");
        assertThat(cookie).isNotNull();
        assertThat(cookie.getPath()).isEqualTo("/api");
        assertThat(cookie.getSecure()).isTrue();
        assertThat(cookie.isHttpOnly()).isFalse();
        assertThat(cookie.getAttribute("SameSite")).isEqualTo("Lax");
    }
}
