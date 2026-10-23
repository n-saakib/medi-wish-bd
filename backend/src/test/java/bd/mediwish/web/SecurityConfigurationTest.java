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
        assertThat(cors.getAllowedMethods()).containsExactly("GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS");
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
    void catalogPutMatchesOneSegmentAndNeverTheAdminOnlyPricingRoute() {
        var catalog = new MockHttpServletRequest("PUT", "/api/staff/products/6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14");
        var pricing = new MockHttpServletRequest("PUT", catalog.getRequestURI() + "/pricing");
        assertThat(SecurityConfiguration.STAFF_CATALOG_COMMANDS.matches(catalog)).isTrue();
        assertThat(SecurityConfiguration.STAFF_CATALOG_COMMANDS.matches(pricing)).isFalse();
        assertThat(SecurityConfiguration.STAFF_PRICING.matches(pricing)).isTrue();
        assertThat(SecurityConfiguration.PROTECTED_ROUTES.matches(pricing)).isTrue();
        assertThat(SecurityConfiguration.BEARER_COMMAND_ROUTES.matches(pricing)).isTrue();
    }

    @Test
    void everyProfileReadAndCommandRunsBearerAuthentication() {
        for (String[] route : new String[][]{
                {"GET", "/api/user/me/profile"}, {"PUT", "/api/user/me/profile"},
                {"POST", "/api/user/me/mobile-change"}, {"DELETE", "/api/user/me/mobile-change"}}) {
            assertThat(SecurityConfiguration.PROTECTED_ROUTES.matches(new MockHttpServletRequest(route[0], route[1])))
                    .as(route[0] + " " + route[1]).isTrue();
        }
    }

    @Test
    void anAdminAuthorityIncludesEveryLowerRoleButRestrictedAuthoritiesIncludeNone() {
        var hierarchy = SecurityConfiguration.roleHierarchy();
        assertThat(hierarchy.getReachableGrantedAuthorities(java.util.List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_ADMIN"))))
                .extracting(org.springframework.security.core.GrantedAuthority::getAuthority)
                .containsExactlyInAnyOrder("ROLE_ADMIN", "ROLE_MODERATOR", "ROLE_DELIVERY_PERSON", "ROLE_CUSTOMER");
        for (String authority : new String[]{"MFA_ENROLLMENT", "MFA_CHALLENGE", "MFA_REPLACEMENT"}) {
            assertThat(hierarchy.getReachableGrantedAuthorities(java.util.List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority(authority))))
                    .extracting(org.springframework.security.core.GrantedAuthority::getAuthority).containsExactly(authority);
        }
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

    @Test
    void discountMatchersAreProtectedAndEndMatchesOnlyItsRoute() {
        for (String[] route : new String[][]{{"GET", "/api/staff/discounts"}, {"POST", "/api/staff/discounts"},
                {"PUT", "/api/staff/discounts/id"}, {"POST", "/api/staff/discounts/id/end"}}) {
            var request = new MockHttpServletRequest(route[0], route[1]);
            assertThat(SecurityConfiguration.PROTECTED_ROUTES.matches(request)).isTrue();
            if (!route[0].equals("GET")) assertThat(SecurityConfiguration.BEARER_COMMAND_ROUTES.matches(request)).isTrue();
        }
        assertThat(SecurityConfiguration.STAFF_DISCOUNT_COMMANDS.matches(new MockHttpServletRequest("PUT", "/api/staff/discounts/id/end"))).isFalse();
        assertThat(SecurityConfiguration.STAFF_DISCOUNT_COMMANDS.matches(new MockHttpServletRequest("PUT", "/api/staff/discounts/id/x/y"))).isFalse();
        var price = new MockHttpServletRequest("GET", "/api/products/id/price");
        assertThat(SecurityConfiguration.PUBLIC_PRODUCT_PRICE.matches(price)).isTrue();
        assertThat(SecurityConfiguration.PROTECTED_ROUTES.matches(price)).isFalse();
        assertThat(SecurityConfiguration.PUBLIC_PRODUCT_PRICE.matches(new MockHttpServletRequest("GET", "/api/products/id/x/price"))).isFalse();
    }

    @Test
    void publicCatalogMatchersCoverOnlyTheirThreeGetRoutesAndNeverRequireBearer() {
        for (String path : new String[]{"/api/categories", "/api/categories/id/products", "/api/products/id"}) {
            var get = new MockHttpServletRequest("GET", path);
            assertThat(SecurityConfiguration.PUBLIC_CATALOG_READS.matches(get)).as(path).isTrue();
            assertThat(SecurityConfiguration.PROTECTED_ROUTES.matches(get)).as(path).isFalse();
            assertThat(SecurityConfiguration.PUBLIC_CATALOG_READS.matches(new MockHttpServletRequest("POST", path)))
                    .as(path).isFalse();
        }
        for (String path : new String[]{"/api/categories/id", "/api/categories/id/products/extra",
                "/api/products/id/price", "/api/products/id/extra", "/api/staff/products/id"}) {
            assertThat(SecurityConfiguration.PUBLIC_CATALOG_READS.matches(new MockHttpServletRequest("GET", path)))
                    .as(path).isFalse();
        }
    }

    @Test
    void addressReadsAndCommandsHaveBearerProtectionAndOnlyCommandsAreCsrfExempt() {
        for (String[] route : new String[][]{{"GET", "/api/user/me/addresses"}, {"POST", "/api/user/me/addresses"},
                {"PUT", "/api/user/me/addresses/4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a11"},
                {"DELETE", "/api/user/me/addresses/4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a11"}}) {
            var request = new MockHttpServletRequest(route[0], route[1]);
            assertThat(SecurityConfiguration.PROTECTED_ROUTES.matches(request)).isTrue();
            assertThat(SecurityConfiguration.BEARER_COMMAND_ROUTES.matches(request)).isEqualTo(!route[0].equals("GET"));
        }
        assertThat(SecurityConfiguration.USER_ADDRESS_COMMANDS.matches(new MockHttpServletRequest("PUT", "/api/user/me/addresses/id/extra"))).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/auth/mfa/recovery", "/api/auth/mfa/backup-codes"})
    void recoveryAndRegenerationAreExplicitBearerMfaCommands(String path) {
        var command = new MockHttpServletRequest("POST", path);
        assertThat(SecurityConfiguration.MFA_ROUTES.matches(command)).isTrue();
        assertThat(SecurityConfiguration.PROTECTED_ROUTES.matches(command)).isTrue();
        assertThat(SecurityConfiguration.MFA_ROUTES.matches(new MockHttpServletRequest("GET", path))).isFalse();
        assertThat(SecurityConfiguration.MFA_ROUTES.matches(new MockHttpServletRequest("POST", path + "/extra"))).isFalse();
    }

    private static CorsConfiguration cors(SecurityConfiguration configuration, String allowedOrigins) {
        return configuration.corsConfigurationSource(allowedOrigins)
                .getCorsConfiguration(new MockHttpServletRequest("GET", "/api/auth/csrf"));
    }
}
