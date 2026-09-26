package bd.mediwish.web;

import bd.mediwish.auth.AuthProperties;
import bd.mediwish.auth.PasswordVerifierPolicy;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.LogoutFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;
import java.util.List;

@Configuration
class SecurityConfiguration {
    // Exclusive PostgreSQL timestamp upper bound; this is a storage limit, not a product lifetime cap.
    private static final Instant POSTGRES_TIMESTAMP_END =
            LocalDate.of(294_277, 1, 1).atStartOfDay().toInstant(ZoneOffset.UTC);
    private static final List<String> LOCAL_ALLOWED_ORIGINS =
            List.of("http://127.0.0.1:3000", "http://localhost:3000");
    private static final List<String> ALLOWED_METHODS = List.of("GET", "POST", "HEAD", "OPTIONS");
    private static final List<String> ALLOWED_HEADERS = List.of(
            "Authorization", "Content-Type", "X-Request-ID", "X-XSRF-TOKEN");

    @Bean
    PasswordEncoder passwordEncoder() {
        return new Argon2PasswordEncoder(16, 32, 1, 19_456, 2);
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${app.cors.allowed-origins:}") String allowedOrigins,
            @Value("${spring.profiles.active:}") String activeProfiles) {
        List<String> origins = parseOrigins(allowedOrigins);
        if (origins.isEmpty() && allowsLocalDevelopmentOverrides(activeProfiles)) {
            origins = LOCAL_ALLOWED_ORIGINS;
        }
        if (origins.isEmpty()) {
            throw new IllegalStateException("hosted CORS origins must be explicitly configured");
        }
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
            PasswordEncoder passwords,
            @Value("${app.auth.cookie.secure:true}") boolean secureCookie,
            @Value("${spring.profiles.active:}") String activeProfiles) {
        validateBase64Secret(properties.jwtSecret());
        if (properties.dummyPasswordVerifier() == null || properties.dummyPasswordVerifier().isBlank()) {
            throw new IllegalStateException("auth dummy password verifier is not configured");
        }
        if (!PasswordVerifierPolicy.isUsable(passwords, properties.dummyPasswordVerifier())) {
            throw new IllegalStateException("auth dummy password verifier is invalid");
        }
        var accessTokenLifetime = properties.accessTokenLifetime();
        if (accessTokenLifetime == null || accessTokenLifetime.toSeconds() < 1) {
            throw new IllegalStateException("auth access-token lifetime must be at least one second");
        }
        Instant now = Instant.now();
        if (!isJwtExpiryRepresentable(now, accessTokenLifetime)) {
            throw new IllegalStateException("auth access-token lifetime is not representable as a JWT date");
        }
        Duration refreshTokenLifetime = properties.refreshTokenLifetime();
        if (refreshTokenLifetime == null || refreshTokenLifetime.toSeconds() < 1) {
            throw new IllegalStateException("auth refresh-token lifetime must be at least one second");
        }
        if (!isStoredExpiryRepresentable(now, refreshTokenLifetime)) {
            throw new IllegalStateException("auth refresh-token lifetime exceeds the supported timestamp range");
        }
        if (!secureCookie && !allowsLocalDevelopmentOverrides(activeProfiles)) {
            throw new IllegalStateException("hosted auth cookies must be Secure");
        }
        return new AuthConfigurationValidation();
    }

    private static boolean isJwtExpiryRepresentable(Instant now, Duration lifetime) {
        try {
            Date.from(now.plus(lifetime));
            return true;
        } catch (DateTimeException | ArithmeticException | IllegalArgumentException exception) {
            return false;
        }
    }

    private static boolean isStoredExpiryRepresentable(Instant now, Duration lifetime) {
        try {
            return now.plus(lifetime).isBefore(POSTGRES_TIMESTAMP_END);
        } catch (DateTimeException | ArithmeticException exception) {
            return false;
        }
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, ApiErrors errors,
                                 BearerAccessTokenFilter bearer,
                                 CsrfTokenRepository csrfTokens,
                                 @Qualifier("corsConfigurationSource") CorsConfigurationSource corsSource) throws Exception {
        return http
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfTokens)
                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
                        .ignoringRequestMatchers(
                                exactRequest("POST", "/api/auth/register"),
                                exactRequest("POST", "/api/auth/login"),
                                exactRequest("GET", "/api/auth/csrf")))
                .cors(cors -> cors.disable())
                .addFilterBefore(new BoundedCorsFilter(corsSource, errors), SecurityContextHolderFilter.class)
                .addFilterAfter(new AuthenticationJsonBodyLimitFilter(errors), BoundedCorsFilter.class)
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

    private List<String> parseOrigins(String allowedOrigins) {
        return Arrays.stream(allowedOrigins == null ? new String[0] : allowedOrigins.split(","))
                .map(String::trim).filter(origin -> !origin.isEmpty()).toList();
    }

    private boolean isUnsafeHealthRequest(jakarta.servlet.http.HttpServletRequest request) {
        String path = request.getRequestURI();
        boolean healthPath = "/actuator/health/liveness".equals(path)
                || "/actuator/health/readiness".equals(path);
        boolean safeMethod = HttpMethod.GET.matches(request.getMethod())
                || HttpMethod.HEAD.matches(request.getMethod());
        return healthPath && !safeMethod;
    }

    private boolean allowsLocalDevelopmentOverrides(String activeProfiles) {
        List<String> profiles = Arrays.stream(activeProfiles == null ? new String[0] : activeProfiles.split(","))
                .map(String::trim)
                .filter(profile -> !profile.isEmpty())
                .toList();
        return !profiles.isEmpty() && profiles.stream().allMatch(profile -> "dev".equalsIgnoreCase(profile)
                        || "development".equalsIgnoreCase(profile)
                        || "local".equalsIgnoreCase(profile)
                        || "test".equalsIgnoreCase(profile));
    }

    static final class AuthConfigurationValidation {}
}
