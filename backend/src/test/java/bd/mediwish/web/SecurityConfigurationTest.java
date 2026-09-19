package bd.mediwish.web;

import bd.mediwish.auth.AuthProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecurityConfigurationTest {
    @Test
    void usesArgon2ForPasswordVerifiers() {
        var encoder = new SecurityConfiguration().passwordEncoder();
        assertThat(encoder).isInstanceOf(Argon2PasswordEncoder.class);
        assertThat(encoder.matches("a-very-long-password", encoder.encode("a-very-long-password"))).isTrue();
        assertThat(encoder.matches("wrong-password", encoder.encode("a-very-long-password"))).isFalse();
    }

    @Test
    void corsIsCredentialedAndRestrictedToConfiguredOriginsAndHeaders() {
        var source = new SecurityConfiguration().corsConfigurationSource(
                "http://127.0.0.1:3000, http://localhost:3000");
        var request = new MockHttpServletRequest("OPTIONS", "/api/auth/refresh");
        request.addHeader("Origin", "http://127.0.0.1:3000");

        var configuration = source.getCorsConfiguration(request);

        assertThat(configuration).isNotNull();
        assertThat(configuration.getAllowedOrigins())
                .containsExactly("http://127.0.0.1:3000", "http://localhost:3000");
        assertThat(configuration.getAllowedMethods()).containsExactly("GET", "POST", "HEAD", "OPTIONS");
        assertThat(configuration.getAllowedHeaders())
                .contains("Authorization", "Content-Type", "X-Request-ID", "X-XSRF-TOKEN");
        assertThat(configuration.getAllowCredentials()).isTrue();
    }

    @Test
    void corsRejectsWildcardOriginsWhenCredentialsAreEnabled() {
        assertThatThrownBy(() -> new SecurityConfiguration().corsConfigurationSource("*"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("credentialed CORS requires explicit origins");
    }

    @Test
    void csrfRepositoryMaterializesTheNonHttpOnlyScopedCookie() {
        CookieCsrfTokenRepository repository = new SecurityConfiguration().csrfTokenRepository(false);
        var request = new MockHttpServletRequest("GET", "/api/auth/csrf");
        var response = new MockHttpServletResponse();

        repository.saveToken(repository.generateToken(request), request, response);

        var cookie = response.getCookie("XSRF-TOKEN");
        assertThat(cookie).isNotNull();
        assertThat(cookie.getPath()).isEqualTo("/api");
        assertThat(cookie.isHttpOnly()).isFalse();
        assertThat(cookie.getSecure()).isFalse();
        assertThat(cookie.getAttribute("SameSite")).isEqualTo("Lax");
    }

    @Test
    void startupValidationRequiresA32ByteBase64SecretAndDummyVerifier() {
        var configuration = new SecurityConfiguration();
        var properties = new AuthProperties();

        assertThatThrownBy(() -> configuration.authConfigurationValidation(properties, true, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth JWT secret is not configured");

        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[32]));
        assertThatThrownBy(() -> configuration.authConfigurationValidation(properties, true, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth dummy password verifier is not configured");

        properties.setDummyPasswordVerifier("dummy-verifier");
        assertThat(configuration.authConfigurationValidation(properties, true, "test")).isNotNull();
    }

    @Test
    void productionProfileCannotDisableSecureAuthCookies() {
        var configuration = new SecurityConfiguration();
        var properties = new AuthProperties();
        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[32]));
        properties.setDummyPasswordVerifier("dummy-verifier");

        assertThatThrownBy(() -> configuration.authConfigurationValidation(properties, false, "production"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("production auth cookies must be Secure");
        assertThat(configuration.authConfigurationValidation(properties, false, "test")).isNotNull();
    }
}
