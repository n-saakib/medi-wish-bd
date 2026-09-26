package bd.mediwish.web;

import bd.mediwish.auth.CurrentUserAuthentication;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.LogoutFilter;

/**
 * Test-only role probe: puts an Admin-only rule on the profile route ahead of the production chain, using the
 * production Bearer filter and protected-route matcher and writing the bounded 403 error. It is only for proving
 * current-role 403/200; the production chain's 401 challenge is tested there. No production route checks a role yet.
 */
@TestConfiguration(proxyBeanMethods = false)
public class AdminOnlyProfileTestConfiguration {
    @Bean
    @Order(0)
    SecurityFilterChain adminOnlyProfile(HttpSecurity http, CurrentUserAuthentication currentUsers, ApiErrors errors)
            throws Exception {
        return http
                .securityMatcher(SecurityConfiguration.PROTECTED_ROUTES)
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .addFilterAfter(new BearerAccessTokenFilter(SecurityConfiguration.PROTECTED_ROUTES, currentUsers, errors),
                        LogoutFilter.class)
                .authorizeHttpRequests(auth -> auth.anyRequest().hasRole("ADMIN"))
                .exceptionHandling(handler -> handler.accessDeniedHandler((request, response, exception) ->
                        errors.write(ApiError.ACCESS_DENIED, request, response)))
                .build();
    }
}
