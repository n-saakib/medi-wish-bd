package bd.mediwish.web;

import bd.mediwish.auth.AuthProperties;
import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.auth.StaffAccessPolicy;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.access.hierarchicalroles.RoleHierarchy;
import org.springframework.security.access.hierarchicalroles.RoleHierarchyImpl;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.LogoutFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class SecurityConfiguration {
    private static final List<String> LOCAL_PROFILES = List.of("local", "test");
    private static final List<String> LOCAL_ALLOWED_ORIGINS =
            List.of("http://127.0.0.1:3000", "http://localhost:3000");
    private static final RequestMatcher USER_PROFILE = route(HttpMethod.GET, "/api/user/me");
    private static final RequestMatcher STAFF_PROFILE = route(HttpMethod.GET, "/api/staff/me");
    private static final RequestMatcher MFA_ENROLLMENT_ROUTES = new OrRequestMatcher(
            route(HttpMethod.POST, "/api/auth/mfa/enrollment"),
            route(HttpMethod.POST, "/api/auth/mfa/enrollment/verify"));
    private static final RequestMatcher MFA_CHALLENGE_ROUTE = route(HttpMethod.POST, "/api/auth/mfa/verify");
    /**
     * Staff authenticator routes: Bearer-only, so CSRF-exempt (a cross-site page cannot send the in-memory token),
     * and body-limited like sign-in.
     */
    static final RequestMatcher MFA_ROUTES = new OrRequestMatcher(MFA_ENROLLMENT_ROUTES, MFA_CHALLENGE_ROUTE);
    /** Every route that needs a Bearer access token; the filter and the authorization rules share it. */
    static final RequestMatcher ADMIN_USER_SEARCH = route(HttpMethod.POST, "/api/admin/users/search");
    static final RequestMatcher ADMIN_USER_DETAIL = route(HttpMethod.GET, "/api/admin/users/*");
    static final RequestMatcher ADMIN_ROLE_CHANGE = route(HttpMethod.PUT, "/api/admin/users/*/roles");
    /** Bearer-only commands need no CSRF cookie; their JSON bodies stay bounded. */
    static final RequestMatcher BEARER_COMMAND_ROUTES = new OrRequestMatcher(ADMIN_USER_SEARCH, ADMIN_ROLE_CHANGE);
    static final RequestMatcher PROTECTED_ROUTES = new OrRequestMatcher(USER_PROFILE, STAFF_PROFILE, MFA_ROUTES,
            ADMIN_USER_SEARCH, ADMIN_USER_DETAIL, ADMIN_ROLE_CHANGE);
    /** Registration and sign-in: public, exempt from CSRF (no session exists yet) and body-limited. */
    static final RequestMatcher CREDENTIAL_ROUTES = new OrRequestMatcher(
            route(HttpMethod.POST, "/api/auth/register"),
            route(HttpMethod.POST, "/api/auth/login"));

    private final boolean localProfile;
    private final boolean secureCookies;

    SecurityConfiguration(Environment environment, AuthProperties properties) {
        String[] profiles = environment.getActiveProfiles();
        localProfile = profiles.length > 0 && LOCAL_PROFILES.containsAll(List.of(profiles));
        secureCookies = properties.cookie().secure();
        if (!secureCookies && !localProfile) {
            throw new IllegalStateException("hosted auth cookies must be Secure");
        }
    }

    @Bean
    static RoleHierarchy roleHierarchy() {
        return RoleHierarchyImpl.withDefaultRolePrefix().role("ADMIN").implies("MODERATOR")
                .role("MODERATOR").implies("DELIVERY_PERSON").role("DELIVERY_PERSON").implies("CUSTOMER").build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(@Value("${app.cors.allowed-origins:}") String allowedOrigins) {
        List<String> origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim).filter(origin -> !origin.isEmpty()).toList();
        if (origins.isEmpty() && localProfile) origins = LOCAL_ALLOWED_ORIGINS;
        if (origins.isEmpty()) throw new IllegalStateException("hosted CORS origins must be explicitly configured");
        if (origins.contains("*")) throw new IllegalStateException("credentialed CORS requires explicit origins");
        var configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(origins);
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "HEAD", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-XSRF-TOKEN"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, ApiErrors errors, CurrentUserAuthentication currentUsers,
                                 @Qualifier("corsConfigurationSource") CorsConfigurationSource corsSource) throws Exception {
        return http
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfTokenRepository())
                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
                        .ignoringRequestMatchers(CREDENTIAL_ROUTES, MFA_ROUTES, BEARER_COMMAND_ROUTES))
                .cors(AbstractHttpConfigurer::disable)
                .addFilterBefore(new BoundedCorsFilter(corsSource, errors), SecurityContextHolderFilter.class)
                .addFilterAfter(new AuthRequestBodyLimitFilter(new OrRequestMatcher(CREDENTIAL_ROUTES, MFA_ROUTES, BEARER_COMMAND_ROUTES), errors), BoundedCorsFilter.class)
                .addFilterAfter(new BearerAccessTokenFilter(PROTECTED_ROUTES, currentUsers, errors), LogoutFilter.class)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .authorizeHttpRequests(auth -> auth
                        .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                        .requestMatchers(HttpMethod.HEAD, "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                        .requestMatchers(CREDENTIAL_ROUTES).permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/auth/csrf").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/refresh", "/api/auth/logout").permitAll()
                        // Authorities come from StaffAccessPolicy: a restricted staff session holds only one MFA
                        // authority, and staff roles apply only to an MFA-verified session.
                        .requestMatchers(MFA_ENROLLMENT_ROUTES).hasAuthority(StaffAccessPolicy.MFA_ENROLLMENT)
                        .requestMatchers(MFA_CHALLENGE_ROUTE).hasAuthority(StaffAccessPolicy.MFA_CHALLENGE)
                        .requestMatchers(STAFF_PROFILE).hasRole("MODERATOR")
                        .requestMatchers(USER_PROFILE).hasRole("CUSTOMER")
                        .requestMatchers(ADMIN_USER_SEARCH, ADMIN_USER_DETAIL, ADMIN_ROLE_CHANGE).hasRole("ADMIN")
                        .anyRequest().denyAll())
                .exceptionHandling(handler -> handler
                        .authenticationEntryPoint((request, response, exception) -> {
                            response.setHeader("WWW-Authenticate", "Bearer");
                            errors.write(ApiError.AUTHENTICATION_REQUIRED, request, response);
                        })
                        .accessDeniedHandler((request, response, exception) ->
                                errors.write(isRestrictedStaff() ? ApiError.MFA_REQUIRED : ApiError.ACCESS_DENIED,
                                        request, response)))
                .build();
    }

    /** A staff session that still has to enroll or verify its authenticator. */
    private static boolean isRestrictedStaff() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getAuthorities().stream()
                .anyMatch(authority -> StaffAccessPolicy.MFA_AUTHORITIES.contains(authority.getAuthority()));
    }

    private static RequestMatcher route(HttpMethod method, String pattern) {
        return PathPatternRequestMatcher.withDefaults().matcher(method, pattern);
    }

    /** The storefront reads the {@code XSRF-TOKEN} cookie, so it is not HttpOnly; it is Secure when auth cookies are. */
    CookieCsrfTokenRepository csrfTokenRepository() {
        var csrfTokens = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfTokens.setCookiePath("/api");
        csrfTokens.setCookieCustomizer(cookie -> cookie.secure(secureCookies).sameSite("Lax"));
        return csrfTokens;
    }
}
