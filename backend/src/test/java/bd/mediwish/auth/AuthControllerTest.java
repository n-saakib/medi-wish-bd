package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserService;
import bd.mediwish.web.ApiErrors;
import bd.mediwish.web.RefreshCookieAdapter;
import bd.mediwish.web.RequestCorrelationFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.http.MediaType;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class AuthControllerTest {
    private static final Instant NOW = Instant.parse("2026-09-23T09:00:00Z");
    private static final int MAX_LOGIN_IDENTIFIER_LENGTH = 320;
    private static final int MAX_LOGIN_PASSWORD_LENGTH = 128;

    @Mock UserService users;
    @Mock AuthenticationService authentication;
    private AuthController controller;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        var messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        var errors = new ApiErrors(messages, JsonMapper.builder().build());
        var cookies = new RefreshCookieAdapter(Duration.ofDays(30), false, Clock.fixed(NOW, ZoneOffset.UTC));
        controller = new AuthController(users, authentication, errors, cookies);
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .addFilters(new RequestCorrelationFilter()).build();
    }

    @Test
    void registrationKeepsTicket02PublicProjection() throws Exception {
        when(users.register("alice_1", "01700000000", "alice@example.com", "a-very-long-password"))
                .thenReturn(new User("alice_1", "01700000000", "alice@example.com", "encoded-verifier"));

        mvc.perform(post("/api/auth/register")
                        .header("X-Request-ID", "register-01")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"alice_1","mobile":"01700000000","email":"alice@example.com","password":"a-very-long-password"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value("alice_1"))
                .andExpect(jsonPath("$.mobileVerificationDeferred").value(true))
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void registrationReturnsBoundedInvalidRequestForWhitespaceOnlyPassword() throws Exception {
        String password = " ".repeat(12);
        when(users.register("alice_1", "01700000000", null, password))
                .thenThrow(new UserService.InvalidRegistrationException());

        var response = mvc.perform(post("/api/auth/register")
                        .header("X-Request-ID", "register-blank-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"alice_1\",\"mobile\":\"01700000000\",\"password\":\""
                                + password + "\"}"))
                .andExpect(status().isBadRequest())
                .andReturn()
                .getResponse();

        String responseBody = response.getContentAsString();
        Map<?, ?> error = JsonMapper.builder().build().readValue(responseBody, Map.class);
        assertThat(error.keySet().stream().map(Object::toString).toList())
                .containsExactlyInAnyOrder("code", "message", "requestId");
        assertThat(error.get("code")).isEqualTo("INVALID_REQUEST");
        assertThat(error.get("message")).isEqualTo("The request is invalid.");
        assertThat(error.get("requestId")).asString()
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                .isNotEqualTo("register-blank-password");
        assertThat(response.getHeader("X-Request-ID")).isEqualTo(error.get("requestId"));
        assertThat(responseBody).hasSizeLessThan(512).doesNotContain("\"password\"");
    }

    @Test
    void loginReturnsSafeSessionAndSetsScopedHttpOnlyRefreshCookie() throws Exception {
        var session = new AuthenticationService.AuthenticatedSession(
                "signed-access-token", 900, "opaque-refresh-token", NOW.plus(Duration.ofDays(30)),
                new AuthenticationService.UserProfile("alice_1", "01700000000", null, true));
        when(authentication.signIn("alice@example.com", "a-very-long-password")).thenReturn(session);

        mvc.perform(post("/api/auth/login")
                        .header("X-Request-ID", "login-01")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"identifier":"alice@example.com","password":"a-very-long-password"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("signed-access-token"))
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.user.username").value("alice_1"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Request-ID",
                        matchesPattern("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")))
                .andExpect(header().string("Set-Cookie",
                        org.hamcrest.Matchers.allOf(
                                org.hamcrest.Matchers.containsString("MW_REFRESH=opaque-refresh-token"),
                                org.hamcrest.Matchers.containsString("Path=/api/auth"),
                                org.hamcrest.Matchers.containsString("Max-Age=2592000"),
                                org.hamcrest.Matchers.containsString("HttpOnly"),
                                org.hamcrest.Matchers.containsString("SameSite=Lax"))));
    }

    @Test
    void loginAcceptsIdentifierAndPasswordAtTheirMaximumLengths() throws Exception {
        String identifier = "i".repeat(MAX_LOGIN_IDENTIFIER_LENGTH);
        String password = "p".repeat(MAX_LOGIN_PASSWORD_LENGTH);
        var session = new AuthenticationService.AuthenticatedSession(
                "signed-access-token", 900, "opaque-refresh-token", NOW.plus(Duration.ofDays(30)),
                new AuthenticationService.UserProfile("alice_1", "01700000000", null, true));
        when(authentication.signIn(identifier, password)).thenReturn(session);

        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginPayload(identifier, password)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("signed-access-token"));
        verify(authentication).signIn(identifier, password);
    }

    @Test
    void loginRejectsIdentifierAndPasswordAboveTheirMaximumLengths() throws Exception {
        for (String[] values : new String[][]{
                {"i".repeat(MAX_LOGIN_IDENTIFIER_LENGTH + 1), "p"},
                {"i", "p".repeat(MAX_LOGIN_PASSWORD_LENGTH + 1)}
        }) {
            mvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(loginPayload(values[0], values[1])))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                    .andExpect(jsonPath("$.requestId").value(
                            matchesPattern("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")));
        }
        org.mockito.Mockito.verifyNoInteractions(authentication);
    }

    @Test
    void refreshCookieMaxAgeDoesNotExceedTheRemainingSessionFamilyLifetime() throws Exception {
        long remainingSeconds = Duration.ofDays(5).toSeconds();
        var session = new AuthenticationService.AuthenticatedSession(
                "signed-access-token", 900, "rotated-refresh-token",
                NOW.plusSeconds(remainingSeconds),
                new AuthenticationService.UserProfile("alice_1", "01700000000", null, true));
        when(authentication.refresh("presented-refresh-token")).thenReturn(session);

        var response = mvc.perform(post("/api/auth/refresh")
                        .header("X-Request-ID", "refresh-cookie-expiry")
                        .cookie(new jakarta.servlet.http.Cookie("MW_REFRESH", "presented-refresh-token")))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse();

        String setCookie = response.getHeader("Set-Cookie");
        assertThat(setCookie).contains("MW_REFRESH=rotated-refresh-token");
        String maxAge = setCookie.split("Max-Age=", 2)[1].split(";", 2)[0];
        assertThat(Long.parseLong(maxAge)).isEqualTo(remainingSeconds);
    }

    @Test
    void csrfBootstrapReturnsTheBoundedNonceForSeparateFrontendOrigins() {
        CsrfToken token = org.mockito.Mockito.mock(CsrfToken.class);
        when(token.getToken()).thenReturn("synthetic-csrf");

        var response = controller.csrf(token);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().csrfToken()).isEqualTo("synthetic-csrf");
    }

    @Test
    void invalidLoginShapeIs400AndFailedAuthenticationIsGeneric401() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .header("X-Request-ID", "login-02")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"identifier\":\"\",\"password\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        when(authentication.signIn(any(), any())).thenThrow(new AuthenticationFailedException());
        mvc.perform(post("/api/auth/login")
                        .header("X-Request-ID", "login-03")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"identifier\":\"missing\",\"password\":\"a-very-long-password\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_FAILED"))
                .andExpect(jsonPath("$.message").value("The identifier or password is invalid."))
                .andExpect(jsonPath("$.requestId").value(
                        matchesPattern("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")));
    }

    @Test
    void missingRefreshCookieIsGeneric401AndLogoutClearsCookie() throws Exception {
        mvc.perform(post("/api/auth/refresh")
                        .header("X-Request-ID", "refresh-01"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        mvc.perform(post("/api/auth/logout")
                        .header("X-Request-ID", "logout-01")
                        .cookie(new jakarta.servlet.http.Cookie("XSRF-TOKEN", "csrf")))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Set-Cookie",
                        org.hamcrest.Matchers.allOf(
                                org.hamcrest.Matchers.containsString("MW_REFRESH="),
                                org.hamcrest.Matchers.containsString("Max-Age=0"),
                                org.hamcrest.Matchers.containsString("Path=/api/auth"),
                                org.hamcrest.Matchers.containsString("HttpOnly"))));
        verify(authentication).logout(List.of());
    }

    @Test
    void logoutRevokesEachDistinctValidRefreshCookieValue() throws Exception {
        mvc.perform(post("/api/auth/logout")
                        .header("X-Request-ID", "logout-duplicates")
                        .cookie(
                                new jakarta.servlet.http.Cookie("XSRF-TOKEN", "csrf"),
                                new jakarta.servlet.http.Cookie("MW_REFRESH", "refresh-one"),
                                new jakarta.servlet.http.Cookie("MW_REFRESH", "refresh-two"),
                                new jakarta.servlet.http.Cookie("MW_REFRESH", "refresh-one"),
                                new jakarta.servlet.http.Cookie("MW_REFRESH", ""),
                                new jakarta.servlet.http.Cookie("MW_REFRESH",
                                        "x".repeat(RefreshCookieAdapter.MAX_COOKIE_VALUE_LENGTH + 1))))
                .andExpect(status().isNoContent());

        verify(authentication).logout(List.of("refresh-one", "refresh-two"));
    }

    private String loginPayload(String identifier, String password) throws Exception {
        return JsonMapper.builder().build().writeValueAsString(Map.of(
                "identifier", identifier,
                "password", password));
    }
}
