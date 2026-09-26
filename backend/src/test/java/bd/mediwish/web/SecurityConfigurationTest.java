package bd.mediwish.web;

import bd.mediwish.auth.AuthProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

import java.time.Duration;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@ExtendWith(OutputCaptureExtension.class)
class SecurityConfigurationTest {
    private static final String VALID_DUMMY_VERIFIER =
            "$argon2id$v=19$m=16384,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    @Test
    void usesArgon2ForPasswordVerifiers() {
        var encoder = new SecurityConfiguration().passwordEncoder();
        assertThat(encoder).isInstanceOf(Argon2PasswordEncoder.class);
        String password = "a-very-long-password";
        String currentVerifier = encoder.encode(password);

        assertThat(currentVerifier.startsWith("$argon2id$v=19$m=19456,t=2,p=1$"))
                .as("new hashes use the ADR-0019 Argon2 profile")
                .isTrue();
        assertThat(encoder.matches(password, currentVerifier)).isTrue();
        assertThat(encoder.matches("wrong-password", currentVerifier)).isFalse();

        String ticket02Verifier = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(password);
        assertThat(encoder.matches(password, ticket02Verifier)).isTrue();
    }

    @Test
    void corsIsCredentialedAndRestrictedToConfiguredOriginsAndHeaders() {
        var source = new SecurityConfiguration().corsConfigurationSource(
                "http://127.0.0.1:3000, http://localhost:3000", "test");
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
        assertThatThrownBy(() -> new SecurityConfiguration().corsConfigurationSource("*", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("credentialed CORS requires explicit origins");
    }

    @Test
    void localProfileUsesOnlyTheDocumentedDevelopmentOriginsWhenUnset() {
        var source = new SecurityConfiguration().corsConfigurationSource("", "test");

        assertThat(source.getCorsConfiguration(new MockHttpServletRequest("GET", "/api/auth/login"))
                .getAllowedOrigins())
                .containsExactly("http://127.0.0.1:3000", "http://localhost:3000");
    }

    @Test
    void implicitLocalCorsFallbackRequiresAnExplicitLocalProfile() {
        var configuration = new SecurityConfiguration();
        for (String profile : new String[] {null, "", " ", "\t", ",", " , , "}) {
            assertThatThrownBy(() -> configuration.corsConfigurationSource("", profile))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("hosted CORS origins must be explicitly configured");
        }
    }

    @Test
    void hostedProfileCannotRelyOnImplicitLocalCorsOrigins() {
        assertThatThrownBy(() -> new SecurityConfiguration().corsConfigurationSource("", "production"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("hosted CORS origins must be explicitly configured");
    }

    @Test
    void nonLocalHostedProfilesCannotRelyOnImplicitLocalCorsOrigins() {
        assertThatThrownBy(() -> new SecurityConfiguration().corsConfigurationSource("", "staging"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("hosted CORS origins must be explicitly configured");
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

        assertThatThrownBy(() -> configuration.authConfigurationValidation(properties, configuration.passwordEncoder(), true, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth JWT secret is not configured");

        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[32]));
        assertThatThrownBy(() -> configuration.authConfigurationValidation(properties, configuration.passwordEncoder(), true, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth dummy password verifier is not configured");

        properties.setDummyPasswordVerifier("dummy-verifier");
        assertThatThrownBy(() -> configuration.authConfigurationValidation(properties, configuration.passwordEncoder(), true, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth dummy password verifier is invalid");

        properties.setDummyPasswordVerifier(VALID_DUMMY_VERIFIER);
        assertThat(configuration.authConfigurationValidation(properties, configuration.passwordEncoder(), true, "test"))
                .isNotNull();
    }

    @Test
    void invalidAuthStartupValuesFailWithoutAppearingInCapturedOutput(CapturedOutput output) {
        String jwtSecret = "SYNTHETIC_INVALID_JWT_SECRET_7ef2";
        String dummyVerifier = "SYNTHETIC_INVALID_DUMMY_VERIFIER_1a93";

        authValidationRunner(jwtSecret, VALID_DUMMY_VERIFIER).run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseMessage("auth JWT secret is invalid");
        });
        authValidationRunner(Base64.getEncoder().encodeToString(new byte[32]), dummyVerifier).run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseMessage("auth dummy password verifier is invalid");
        });

        assertThat(output.getAll())
                .contains("auth JWT secret is invalid", "auth dummy password verifier is invalid")
                .doesNotContain(jwtSecret, dummyVerifier)
                .hasSizeLessThan(65536);
    }

    @Test
    void startupValidationRequiresAValidAccessLifetimeAndAllowsLongValues() {
        var configuration = new SecurityConfiguration();
        var properties = new AuthProperties();
        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[32]));
        properties.setDummyPasswordVerifier(VALID_DUMMY_VERIFIER);

        for (Duration lifetime : new Duration[] {
                null, Duration.ZERO, Duration.ofSeconds(-1), Duration.ofNanos(999_999_999)}) {
            properties.setAccessTokenLifetime(lifetime);
            assertThatThrownBy(() -> configuration.authConfigurationValidation(
                    properties, configuration.passwordEncoder(), true, "test"))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("auth access-token lifetime must be at least one second");
        }

        properties.setAccessTokenLifetime(Duration.ofDays(3650));
        properties.setRefreshTokenLifetime(Duration.ofDays(3650));
        assertThat(configuration.authConfigurationValidation(
                properties, configuration.passwordEncoder(), true, "test"))
                .isNotNull();
    }

    @Test
    void startupValidationRejectsLifetimesOutsideTheirTokenAndPersistenceRanges() {
        var configuration = new SecurityConfiguration();
        var properties = new AuthProperties();
        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[32]));
        properties.setDummyPasswordVerifier(VALID_DUMMY_VERIFIER);

        properties.setAccessTokenLifetime(Duration.ofDays(110_000_000_000L));
        assertThatThrownBy(() -> configuration.authConfigurationValidation(
                properties, configuration.passwordEncoder(), true, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth access-token lifetime is not representable as a JWT date");

        properties.setAccessTokenLifetime(Duration.ofMinutes(15));
        for (Duration lifetime : new Duration[] {
                null, Duration.ZERO, Duration.ofSeconds(-1), Duration.ofNanos(999_999_999)}) {
            properties.setRefreshTokenLifetime(lifetime);
            assertThatThrownBy(() -> configuration.authConfigurationValidation(
                    properties, configuration.passwordEncoder(), true, "test"))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("auth refresh-token lifetime must be at least one second");
        }

        properties.setRefreshTokenLifetime(Duration.ofDays(110_000_000L));
        assertThatThrownBy(() -> configuration.authConfigurationValidation(
                properties, configuration.passwordEncoder(), true, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth refresh-token lifetime exceeds the supported timestamp range");
    }

    @Test
    void productionProfileCannotDisableSecureAuthCookies() {
        var configuration = new SecurityConfiguration();
        var properties = new AuthProperties();
        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[32]));
        properties.setDummyPasswordVerifier(VALID_DUMMY_VERIFIER);

        assertThatThrownBy(() -> configuration.authConfigurationValidation(properties, configuration.passwordEncoder(), false, "production"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("hosted auth cookies must be Secure");
        assertThat(configuration.authConfigurationValidation(properties, configuration.passwordEncoder(), false, "test")).isNotNull();
    }

    @Test
    void hostedNonProductionProfileCannotDisableSecureAuthCookies() {
        var configuration = new SecurityConfiguration();
        var properties = new AuthProperties();
        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[32]));
        properties.setDummyPasswordVerifier(VALID_DUMMY_VERIFIER);

        assertThatThrownBy(() -> configuration.authConfigurationValidation(properties, configuration.passwordEncoder(), false, "staging"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("hosted auth cookies must be Secure");
    }

    @Test
    void insecureAuthCookiesRequireAnExplicitLocalProfile() {
        var configuration = new SecurityConfiguration();
        var properties = new AuthProperties();
        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[32]));
        properties.setDummyPasswordVerifier(VALID_DUMMY_VERIFIER);

        for (String profile : new String[] {null, "", " ", "\t", ",", " , , "}) {
            assertThatThrownBy(() -> configuration.authConfigurationValidation(
                    properties, configuration.passwordEncoder(), false, profile))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("hosted auth cookies must be Secure");
        }
    }

    private static ApplicationContextRunner authValidationRunner(String jwtSecret, String dummyVerifier) {
        return new ApplicationContextRunner()
                .withUserConfiguration(AuthValidationTestConfiguration.class)
                .withPropertyValues(
                        "app.auth.jwt-secret=" + jwtSecret,
                        "app.auth.dummy-password-verifier=" + dummyVerifier,
                        "app.auth.cookie.secure=false",
                        "spring.profiles.active=test");
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AuthProperties.class)
    static class AuthValidationTestConfiguration {
        @Bean
        PasswordEncoder passwordEncoder() {
            return new SecurityConfiguration().passwordEncoder();
        }

        @Bean
        SecurityConfiguration.AuthConfigurationValidation authConfigurationValidation(
                AuthProperties properties,
                PasswordEncoder passwords,
                @Value("${app.auth.cookie.secure:true}") boolean secureCookie,
                @Value("${spring.profiles.active:}") String activeProfiles) {
            return new SecurityConfiguration().authConfigurationValidation(
                    properties, passwords, secureCookie, activeProfiles);
        }
    }
}
