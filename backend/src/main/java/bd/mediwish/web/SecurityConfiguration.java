package bd.mediwish.web;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.config.Customizer;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import bd.mediwish.user.UserService;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Arrays;

@Configuration
class SecurityConfiguration {
    @Bean
    PasswordEncoder passwordEncoder() { return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8(); }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${app.cors.allowed-origins:http://127.0.0.1:3000,http://localhost:3000}") String allowedOrigins) {
        var configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(Arrays.stream(allowedOrigins.split(","))
                .map(String::trim).filter(origin -> !origin.isEmpty()).toList());
        configuration.setAllowedMethods(java.util.List.of("GET", "POST", "HEAD", "OPTIONS"));
        configuration.setAllowedHeaders(java.util.List.of("Authorization", "Content-Type", "X-Request-ID"));
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    @Bean
    UserDetailsService users(UserRepository users) {
        return username -> users.findByUsername(UserService.normalizeUsername(username))
                .map(user -> org.springframework.security.core.userdetails.User.withUsername(user.username())
                        .password(user.passwordHash())
                        .roles(user.roles().stream().map(UserRole::name).toArray(String[]::new)).build())
                .orElseThrow(() -> new UsernameNotFoundException("user not found"));
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, ApiErrors errors) throws Exception {
        return http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .httpBasic(basic -> {})
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .authorizeHttpRequests(auth -> auth
                        .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                        .requestMatchers(HttpMethod.HEAD, "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/register").permitAll()
                        .requestMatchers("/api/user/**").authenticated()
                        .anyRequest().denyAll())
                .exceptionHandling(handler -> handler
                        .authenticationEntryPoint((req, res, ex) -> {
                            int status = isUnsafeHealthRequest(req) ? 403 : 401;
                            if (status == 401) res.setHeader("WWW-Authenticate", "Basic realm=\"user\"");
                            errors.write(status, req, res);
                        })
                        .accessDeniedHandler((req, res, ex) -> errors.write(403, req, res)))
                .build();
    }

    private boolean isUnsafeHealthRequest(jakarta.servlet.http.HttpServletRequest request) {
        String path = request.getRequestURI();
        boolean healthPath = "/actuator/health/liveness".equals(path)
                || "/actuator/health/readiness".equals(path);
        boolean safeMethod = HttpMethod.GET.matches(request.getMethod())
                || HttpMethod.HEAD.matches(request.getMethod());
        return healthPath && !safeMethod;
    }
}
