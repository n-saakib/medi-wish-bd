package bd.mediwish.web;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.LogoutFilter;

/** Applies a protected-authority rule to the real profile route only in Ticket 03 integration tests. */
@TestConfiguration(proxyBeanMethods = false)
public class Ticket03RoleAuthorizationTestConfiguration {
    @Bean
    @Order(0)
    SecurityFilterChain ticket03RoleProtectedProfile(HttpSecurity http,
                                                     BearerAccessTokenFilter bearer,
                                                     ApiErrors errors) throws Exception {
        return http
                .securityMatcher("/api/user/me")
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .addFilterAfter(bearer, LogoutFilter.class)
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/api/user/me").hasAuthority("ROLE_ADMIN")
                        .anyRequest().denyAll())
                .exceptionHandling(handler -> handler
                        .authenticationEntryPoint((request, response, exception) -> {
                            response.setHeader("WWW-Authenticate", "Bearer");
                            errors.write(HttpServletResponse.SC_UNAUTHORIZED, request, response);
                        })
                        .accessDeniedHandler((request, response, exception) ->
                                errors.write(HttpServletResponse.SC_FORBIDDEN, request, response)))
                .build();
    }
}
