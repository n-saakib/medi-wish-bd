package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.User;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.csrf.DefaultCsrfToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.endsWith;
import static org.hamcrest.Matchers.startsWith;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.json.JsonCompareMode.STRICT;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class AuthControllerTest {
    private static final Instant NOW = Instant.parse("2026-09-23T09:00:00Z");
    private static final UserProfile PROFILE = new UserProfile("alice_1", "01700000000", null, true);

    @Mock UserService users;
    @Mock AuthenticationService authentication;
    private AuthController controller;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        var properties = new AuthProperties(Duration.ofMinutes(15), Duration.ofDays(30), "medi-wish",
                "medi-wish-api", "unused", new AuthProperties.Cookie(true), TestAuthSettings.mfa());
        controller = new AuthController(users, authentication,
                new RefreshCookieAdapter(properties, Clock.fixed(NOW, ZoneOffset.UTC)));
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void registrationReturnsTheTicket02ProjectionWithoutThePassword() throws Exception {
        when(users.register("alice_1", "01700000000", "alice@example.com", "a-very-long-password"))
                .thenReturn(new User("alice_1", "01700000000", "alice@example.com", "encoded-verifier"));

        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("""
                        {"username":"alice_1","mobile":"01700000000","email":"alice@example.com","password":"a-very-long-password"}
                        """))
                .andExpect(status().isCreated())
                .andExpect(content().json("""
                        {"username":"alice_1","mobile":"01700000000","email":"alice@example.com","mobileVerificationDeferred":true}
                        """, STRICT));
    }

    @Test
    void loginReturnsTheSessionAndAScopedHttpOnlySecureRefreshCookie() throws Exception {
        when(authentication.signIn("alice@example.com", "a-very-long-password")).thenReturn(session(Duration.ofDays(30)));

        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(login("alice@example.com", "a-very-long-password")))
                .andExpect(status().isOk())
                .andExpect(content().json("""
                        {"accessToken":"signed-access-token","tokenType":"Bearer","expiresIn":900,
                         "user":{"username":"alice_1","mobile":"01700000000","email":null,"mobileVerified":true},
                         "mfa":"NOT_REQUIRED"}
                        """, STRICT))
                .andExpect(header().string("Set-Cookie", allOf(
                        startsWith("MW_REFRESH=rotated-refresh; Path=/api/auth; Max-Age=2592000;"),
                        endsWith("; Secure; HttpOnly; SameSite=Lax"))));
    }

    @Test
    void loginAcceptsTheMaximumLengths() throws Exception {
        String identifier = "i".repeat(320);
        String password = "p".repeat(128);
        when(authentication.signIn(identifier, password)).thenReturn(session(Duration.ofDays(30)));

        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(login(identifier, password)))
                .andExpect(status().isOk());
    }

    @Test
    void loginRejectsBlankMissingAndOversizedFieldsWithoutAuthenticating() {
        var response = new MockHttpServletResponse();
        for (var request : List.of(
                new AuthController.LoginRequest(" ", "a-very-long-password"),
                new AuthController.LoginRequest("alice_1", ""),
                new AuthController.LoginRequest(null, "a-very-long-password"),
                new AuthController.LoginRequest("alice_1", null),
                new AuthController.LoginRequest("i".repeat(321), "a-very-long-password"),
                new AuthController.LoginRequest("alice_1", "p".repeat(129)))) {
            assertThatThrownBy(() -> controller.login(request, response)).isInstanceOf(InvalidRequestException.class);
        }
        verifyNoInteractions(authentication);
    }

    @Test
    void csrfBootstrapReturnsTheNonce() {
        var token = new DefaultCsrfToken("X-XSRF-TOKEN", "_csrf", "synthetic-csrf");

        assertThat(controller.csrf(token).csrfToken()).isEqualTo("synthetic-csrf");
    }

    @Test
    void refreshWithoutACookieIsSignedOutWith204AndNoCookie() throws Exception {
        mvc.perform(post("/api/auth/refresh").cookie(new Cookie("XSRF-TOKEN", "csrf")))
                .andExpect(status().isNoContent())
                .andExpect(content().string(""))
                .andExpect(header().doesNotExist("Set-Cookie"));
        verifyNoInteractions(authentication);
    }

    @Test
    void refreshRotatesTheCookieForTheRemainingSessionLifetime() throws Exception {
        when(authentication.refresh("presented-refresh")).thenReturn(session(Duration.ofDays(5)));

        mvc.perform(post("/api/auth/refresh").cookie(new Cookie("MW_REFRESH", "presented-refresh")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("signed-access-token"))
                .andExpect(header().string("Set-Cookie", startsWith(
                        "MW_REFRESH=rotated-refresh; Path=/api/auth; Max-Age=432000;")));
    }

    @Test
    void aRejectedRefreshCookieIsClearedWithThe401() {
        when(authentication.refresh("revoked-refresh")).thenThrow(new SessionReplayException());
        var response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.refresh(requestWith(new Cookie("MW_REFRESH", "revoked-refresh")), response))
                .isInstanceOf(AuthenticationRequiredException.class);
        assertClearedCookie(response);
    }

    @Test
    void anUnusableOrDuplicatedRefreshCookieIsClearedWithoutRefreshing() {
        for (Cookie[] cookies : new Cookie[][]{
                {new Cookie("MW_REFRESH", "")},
                {new Cookie("MW_REFRESH", "x".repeat(RefreshCookieAdapter.MAX_VALUE_LENGTH + 1))},
                {new Cookie("MW_REFRESH", "one"), new Cookie("MW_REFRESH", "two")}}) {
            var response = new MockHttpServletResponse();
            assertThatThrownBy(() -> controller.refresh(requestWith(cookies), response))
                    .isInstanceOf(AuthenticationRequiredException.class);
            assertClearedCookie(response);
        }
        verifyNoInteractions(authentication);
    }

    @Test
    void logoutRevokesEachDistinctUsableValueAndClearsTheCookie() {
        var response = new MockHttpServletResponse();

        controller.logout(requestWith(
                new Cookie("MW_REFRESH", "refresh-one"),
                new Cookie("MW_REFRESH", "refresh-two"),
                new Cookie("MW_REFRESH", "refresh-one"),
                new Cookie("MW_REFRESH", ""),
                new Cookie("MW_REFRESH", "x".repeat(RefreshCookieAdapter.MAX_VALUE_LENGTH + 1))), response);

        verify(authentication).logout(List.of("refresh-one", "refresh-two"));
        assertClearedCookie(response);
    }

    @Test
    void logoutWithoutACookieStillClearsIt() {
        var response = new MockHttpServletResponse();

        controller.logout(new MockHttpServletRequest(), response);

        verify(authentication).logout(List.of());
        assertClearedCookie(response);
    }

    private static AuthenticationService.AuthenticatedSession session(Duration remaining) {
        return new AuthenticationService.AuthenticatedSession("signed-access-token", 900, "rotated-refresh",
                NOW.plus(remaining), PROFILE, MfaStatus.NOT_REQUIRED);
    }

    private static MockHttpServletRequest requestWith(Cookie... cookies) {
        var request = new MockHttpServletRequest("POST", "/api/auth/refresh");
        request.setCookies(cookies);
        return request;
    }

    private static void assertClearedCookie(MockHttpServletResponse response) {
        assertThat(response.getHeader("Set-Cookie"))
                .startsWith("MW_REFRESH=; Path=/api/auth; Max-Age=0;")
                .contains("HttpOnly", "Secure", "SameSite=Lax");
    }

    private static String login(String identifier, String password) {
        return "{\"identifier\":\"" + identifier + "\",\"password\":\"" + password + "\"}";
    }
}
