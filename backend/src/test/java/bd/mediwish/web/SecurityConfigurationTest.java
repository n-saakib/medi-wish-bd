package bd.mediwish.web;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.cors.CorsConfiguration;

import static bd.mediwish.web.WebTestFixtures.securityConfiguration;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatNoException;

class SecurityConfigurationTest {
    private static final String LOCAL_ORIGINS = "http://127.0.0.1:3000,http://localhost:3000";

    @ParameterizedTest
    @ValueSource(strings = {"", "production", "staging", "local,production", "test,staging"})
    void insecureCookiesFailStartupOutsideAnExclusivelyLocalProfile(String profiles) {
        assertThatThrownBy(() -> securityConfiguration(false, profiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("hosted auth cookies must be Secure");
    }

    @ParameterizedTest
    @ValueSource(strings = {"local", "test", "local,test"})
    void insecureCookiesAreAllowedUnderTheLocalAndTestProfiles(String profiles) {
        assertThatNoException().isThrownBy(() -> securityConfiguration(false, profiles));
    }

    @Test
    void secureCookiesAreAllowedUnderAnyProfile() {
        assertThatNoException().isThrownBy(() -> securityConfiguration(true, "production"));
        assertThatNoException().isThrownBy(() -> securityConfiguration(true, ""));
    }

    @Test
    void corsIsCredentialedAndLimitedToTheConfiguredOriginsMethodsAndHeaders() {
        var cors = cors(securityConfiguration(true, "production"), " https://shop.example.test , https://www.example.test ");

        assertThat(cors.getAllowedOrigins()).containsExactly("https://shop.example.test", "https://www.example.test");
        assertThat(cors.getAllowedMethods()).containsExactly("GET", "POST", "PUT", "HEAD", "OPTIONS");
        assertThat(cors.getAllowedHeaders()).containsExactly("Authorization", "Content-Type", "X-XSRF-TOKEN");
        assertThat(cors.getAllowCredentials()).isTrue();
    }

    @Test
    void onlyALocalProfileFallsBackToTheLocalFrontendOrigins() {
        assertThat(cors(securityConfiguration(false, "local"), "").getAllowedOrigins())
                .containsExactly(LOCAL_ORIGINS.split(","));
        for (String profiles : new String[]{"", "production", "local,production"}) {
            assertThatThrownBy(() -> cors(securityConfiguration(true, profiles), " , "))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("hosted CORS origins must be explicitly configured");
        }
    }

    @Test
    void aWildcardOriginIsRejectedBecauseCorsIsCredentialed() {
        assertThatThrownBy(() -> cors(securityConfiguration(false, "test"), "https://shop.example.test,*"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("credentialed CORS requires explicit origins");
    }

    @Test
    void theHostedCsrfCookieIsSecureReadableByTheStorefrontAndScopedToTheApi() {
        var repository = securityConfiguration(true, "").csrfTokenRepository();
        var request = new MockHttpServletRequest("GET", "/api/auth/csrf");
        var response = new MockHttpServletResponse();

        repository.saveToken(repository.generateToken(request), request, response);

        var cookie = response.getCookie("XSRF-TOKEN");
        assertThat(cookie).isNotNull();
        assertThat(cookie.getSecure()).isTrue();
        assertThat(cookie.isHttpOnly()).isFalse();
        assertThat(cookie.getPath()).isEqualTo("/api");
        assertThat(cookie.getAttribute("SameSite")).isEqualTo("Lax");
    }

    @Test
    void anAdminAuthorityIncludesEveryLowerRoleButRestrictedAuthoritiesIncludeNone() {
        var hierarchy = SecurityConfiguration.roleHierarchy();
        assertThat(hierarchy.getReachableGrantedAuthorities(java.util.List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_ADMIN"))))
                .extracting(org.springframework.security.core.GrantedAuthority::getAuthority)
                .containsExactlyInAnyOrder("ROLE_ADMIN", "ROLE_MODERATOR", "ROLE_DELIVERY_PERSON", "ROLE_CUSTOMER");
        assertThat(hierarchy.getReachableGrantedAuthorities(java.util.List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("MFA_ENROLLMENT"))))
                .extracting(org.springframework.security.core.GrantedAuthority::getAuthority).containsExactly("MFA_ENROLLMENT");
    }

    @Test
    void searchAndRoleChangesShareBearerProtectionAndBodyLimitMatchers() {
        for (var request : java.util.List.of(new MockHttpServletRequest("POST", "/api/admin/users/search"),
                new MockHttpServletRequest("PUT", "/api/admin/users/3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e5f/roles"))) {
            assertThat(SecurityConfiguration.PROTECTED_ROUTES.matches(request)).isTrue();
            assertThat(SecurityConfiguration.BEARER_COMMAND_ROUTES.matches(request)).isTrue();
        }
        assertThat(SecurityConfiguration.BEARER_COMMAND_ROUTES.matches(new MockHttpServletRequest("POST", "/api/auth/refresh"))).isFalse();
    }

    private static CorsConfiguration cors(SecurityConfiguration configuration, String allowedOrigins) {
        return configuration.corsConfigurationSource(allowedOrigins)
                .getCorsConfiguration(new MockHttpServletRequest("GET", "/api/auth/csrf"));
    }
}
