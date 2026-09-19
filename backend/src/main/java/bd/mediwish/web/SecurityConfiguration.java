package bd.mediwish.web;

import bd.mediwish.auth.AuthProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.LogoutFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.Base64;
import java.util.List;

@Configuration
class SecurityConfiguration {
    private static final List<String> ALLOWED_METHODS = List.of("GET", "POST", "HEAD", "OPTIONS");
    private static final List<String> ALLOWED_HEADERS = List.of(
            "Authorization", "Content-Type", "X-Request-ID", "X-XSRF-TOKEN");

    @Bean
    PasswordEncoder passwordEncoder() {
        return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${app.cors.allowed-origins:http://127.0.0.1:3000,http://localhost:3000}") String allowedOrigins) {
        List<String> origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim).filter(origin -> !origin.isEmpty()).toList();
        if (origins.stream().anyMatch("*"::equals)) {
            throw new IllegalStateException("credentialed CORS requires explicit origins");
        }
        var configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(origins);
        configuration.setAllowedMethods(ALLOWED_METHODS);
        configuration.setAllowedHeaders(ALLOWED_HEADERS);
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    @Bean
    CookieCsrfTokenRepository csrfTokenRepository(
            @Value("${app.auth.cookie.secure:true}") boolean secureCookie) {
        var repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setCookieName("XSRF-TOKEN");
        repository.setHeaderName("X-XSRF-TOKEN");
        repository.setCookiePath("/api");
        repository.setCookieCustomizer(builder -> builder
                .httpOnly(false)
                .secure(secureCookie)
                .sameSite("Lax")
                .path("/api"));
        return repository;
    }

    @Bean
    AuthConfigurationValidation authConfigurationValidation(
            AuthProperties properties,
            @Value("${app.auth.cookie.secure:true}") boolean secureCookie,
            @Value("${spring.profiles.active:}") String activeProfiles) {
        validateBase64Secret(properties.jwtSecret());
        if (properties.dummyPasswordVerifier() == null || properties.dummyPasswordVerifier().isBlank()) {
            throw new IllegalStateException("auth dummy password verifier is not configured");
        }
        if (!secureCookie && isProductionProfile(activeProfiles)) {
            throw new IllegalStateException("production auth cookies must be Secure");
        }
        return new AuthConfigurationValidation();
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, ApiErrors errors,
                                 BearerAccessTokenFilter bearer,
                                 CsrfTokenRepository csrfTokens) throws Exception {
        return http
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfTokens)
                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
                        .ignoringRequestMatchers(
                                exactRequest("POST", "/api/auth/register"),
                                exactRequest("POST", "/api/auth/login"),
                                exactRequest("GET", "/api/auth/csrf")))
                .cors(Customizer.withDefaults())
                .addFilterAfter(bearer, LogoutFilter.class)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .authorizeHttpRequests(auth -> auth
                        .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                        .requestMatchers(HttpMethod.HEAD, "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/auth/csrf").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/refresh", "/api/auth/logout").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/user/me").authenticated()
                        .anyRequest().denyAll())
                .exceptionHandling(handler -> handler
                        .authenticationEntryPoint((request, response, exception) -> {
                            int status = isUnsafeHealthRequest(request) ? 403 : 401;
                            if (status == 401) response.setHeader("WWW-Authenticate", "Bearer");
                            errors.write(status, request, response);
                        })
                        .accessDeniedHandler((request, response, exception) -> errors.write(403, request, response)))
                .build();
    }

    private void validateBase64Secret(String encoded) {
        if (encoded == null || encoded.isBlank()) {
            throw new IllegalStateException("auth JWT secret is not configured");
        }
        try {
            if (Base64.getDecoder().decode(encoded).length < 32) {
                throw new IllegalStateException("auth JWT secret is too short");
            }
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("auth JWT secret is invalid");
        }
    }

    private RequestMatcher exactRequest(String method, String path) {
        return request -> method.equals(request.getMethod()) && path.equals(request.getRequestURI());
    }

    private boolean isUnsafeHealthRequest(jakarta.servlet.http.HttpServletRequest request) {
        String path = request.getRequestURI();
        boolean healthPath = "/actuator/health/liveness".equals(path)
                || "/actuator/health/readiness".equals(path);
        boolean safeMethod = HttpMethod.GET.matches(request.getMethod())
                || HttpMethod.HEAD.matches(request.getMethod());
        return healthPath && !safeMethod;
    }

    private boolean isProductionProfile(String activeProfiles) {
        return Arrays.stream(activeProfiles == null ? new String[0] : activeProfiles.split(","))
                .map(String::trim)
                .anyMatch(profile -> "prod".equalsIgnoreCase(profile)
                        || "production".equalsIgnoreCase(profile));
    }

    static final class AuthConfigurationValidation {}
}
