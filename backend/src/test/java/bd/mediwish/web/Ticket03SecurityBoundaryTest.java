package bd.mediwish.web;

import bd.mediwish.auth.AuthController;
import bd.mediwish.auth.AuthenticationService;
import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.user.UserController;
import bd.mediwish.user.UserService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class Ticket03SecurityBoundaryTest {
    private static final String SERVER_REQUEST_ID =
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    @Mock CurrentUserAuthentication currentUsers;
    @Mock UserService users;
    @Mock AuthenticationService authentication;
    private MockMvc mvc;
    private AuthenticationJsonBodyLimitFilter authenticationBodyLimit;

    @BeforeEach
    void setUp() throws Exception {
        var messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        var errors = new ApiErrors(messages, JsonMapper.builder().build());
        var securityRequest = new SecurityContextHolderAwareRequestFilter();
        securityRequest.afterPropertiesSet();
        var configuration = new SecurityConfiguration();
        authenticationBodyLimit = new AuthenticationJsonBodyLimitFilter(errors);
        mvc = MockMvcBuilders.standaloneSetup(
                        new UserController(errors),
                        new AuthController(users, authentication, errors,
                                new RefreshCookieAdapter(Duration.ofDays(30), false)))
                .addFilters(new RequestCorrelationFilter(),
                        new BoundedCorsFilter(configuration.corsConfigurationSource("http://127.0.0.1:3000", "test"), errors),
                        authenticationBodyLimit,
                        new BearerAccessTokenFilter(currentUsers, errors), securityRequest)
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
                .andExpect(jsonPath("$.requestId", matchesPattern(SERVER_REQUEST_ID)));

        verifyNoInteractions(currentUsers);
    }

    @Test
    void malformedAndOversizedBearerValuesUseTheBoundedErrorShape() throws Exception {
        mvc.perform(get("/api/user/me")
                        .header("Authorization", "Bearer")
                        .header("X-Request-ID", "boundary-malformed"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId", matchesPattern(SERVER_REQUEST_ID)));

        String oversized = "Bearer " + "x".repeat(4097);
        mvc.perform(get("/api/user/me")
                        .header("Authorization", oversized)
                        .header("X-Request-ID", "boundary-oversized"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", "Bearer"))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId", matchesPattern(SERVER_REQUEST_ID)));

        verifyNoInteractions(currentUsers);
    }

    @Test
    void rejectedCorsUsesTheBoundedErrorEnvelopeAndCorrelationHeaders() throws Exception {
        var result = mvc.perform(get("/api/user/me")
                        .header("Origin", "https://evil.example.test")
                        .header("X-Request-ID", "boundary-cors"))
                .andExpect(status().isForbidden())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Request-ID", matchesPattern(SERVER_REQUEST_ID)))
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"))
                .andExpect(jsonPath("$.message").value("Access is denied."))
                .andExpect(jsonPath("$.requestId", matchesPattern(SERVER_REQUEST_ID)))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("Invalid CORS request"))))
                .andReturn();

        String responseId = result.getResponse().getHeader("X-Request-ID");
        var error = JsonMapper.builder().build().readValue(result.getResponse().getContentAsString(), Map.class);
        assertThat(responseId).isNotEqualTo("boundary-cors");
        assertThat(error.get("requestId")).isEqualTo(responseId);
        assertThat(result.getResponse().getContentAsString()).doesNotContain("boundary-cors");
    }

    @Test
    void oversizedAuthenticationJsonIsRejectedBeforeControllerDeserialization() throws Exception {
        String oversized = "{\"identifier\":\"synthetic\",\"password\":\""
                + "x".repeat(AuthenticationJsonBodyLimitFilter.MAX_BODY_BYTES) + "\"}";

        MediaType[] jsonMediaTypes = {
                MediaType.APPLICATION_JSON,
                MediaType.parseMediaType("application/json;charset=UTF-8"),
                MediaType.parseMediaType("application/vnd.mediwish+json")
        };
        for (String path : new String[]{"/api/auth/login", "/api/auth/register"}) {
            String requestId = path.endsWith("login") ? "boundary-login-body" : "boundary-register-body";
            for (MediaType jsonMediaType : jsonMediaTypes) {
                mvc.perform(post(path)
                                .header("X-Request-ID", requestId)
                                .contentType(jsonMediaType)
                                .content(oversized))
                        .andExpect(status().isBadRequest())
                        .andExpect(header().string("Cache-Control", "no-store"))
                        .andExpect(header().string("X-Request-ID", matchesPattern(SERVER_REQUEST_ID)))
                        .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                        .andExpect(jsonPath("$.requestId", matchesPattern(SERVER_REQUEST_ID)))
                        .andExpect(jsonPath("$.message").value("The request is invalid."));
            }
        }

        verifyNoInteractions(currentUsers, users, authentication);
    }

    @Test
    void oversizedNonJsonAuthenticationBodiesUseNormalMediaTypeHandling() throws Exception {
        String oversized = "x".repeat(AuthenticationJsonBodyLimitFilter.MAX_BODY_BYTES + 1);

        for (String path : new String[]{"/api/auth/login", "/api/auth/register"}) {
            mvc.perform(post(path)
                            .contentType(MediaType.TEXT_PLAIN)
                            .content(oversized))
                    .andExpect(status().is(415));
            mvc.perform(post(path).content(oversized))
                    .andExpect(status().is(415));
        }

        verifyNoInteractions(currentUsers, users, authentication);
    }

    @Test
    void oversizedAuthenticationJsonIsRejectedWhenContentLengthIsUnknownOrUnderreported() throws Exception {
        byte[] oversized = ("{\"identifier\":\"synthetic\",\"password\":\""
                + "x".repeat(AuthenticationJsonBodyLimitFilter.MAX_BODY_BYTES) + "\"}")
                .getBytes(StandardCharsets.UTF_8);

        for (long declaredLength : new long[]{-1L, 1L}) {
            var original = new MockHttpServletRequest("POST", "/api/auth/login");
            original.setContentType(MediaType.APPLICATION_JSON_VALUE);
            original.setContent(oversized);
            var request = new HttpServletRequestWrapper(original) {
                @Override
                public int getContentLength() {
                    return Math.toIntExact(declaredLength);
                }

                @Override
                public long getContentLengthLong() {
                    return declaredLength;
                }
            };
            var response = new MockHttpServletResponse();
            boolean[] chainInvoked = {false};

            authenticationBodyLimit.doFilter(request, response,
                    (filteredRequest, filteredResponse) -> chainInvoked[0] = true);

            assertThat(response.getStatus()).isEqualTo(400);
            assertThat(chainInvoked[0]).isFalse();
            assertThat(response.getContentAsString())
                    .hasSizeLessThan(512)
                    .contains("INVALID_REQUEST")
                    .doesNotContain("synthetic");
        }
    }

    @Test
    void hostedRefreshCookieIsSecureScopedAndClearsWithTheSameBoundary() {
        Instant now = Instant.parse("2026-09-23T09:00:00Z");
        var cookies = new RefreshCookieAdapter(Duration.ofDays(30), true, Clock.fixed(now, ZoneOffset.UTC));
        var setResponse = new MockHttpServletResponse();

        cookies.set(setResponse, "synthetic-refresh", now.plus(Duration.ofDays(30)));

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
