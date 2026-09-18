package bd.mediwish.web;

import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.core.userdetails.UserDetailsService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

class SecurityConfigurationTest {
    @Test
    void usesArgon2ForPasswordVerifiers() {
        var encoder = new SecurityConfiguration().passwordEncoder();
        assertThat(encoder).isInstanceOf(Argon2PasswordEncoder.class);
        assertThat(encoder.matches("a-very-long-password", encoder.encode("a-very-long-password"))).isTrue();
        assertThat(encoder.matches("wrong-password", encoder.encode("a-very-long-password"))).isFalse();
    }

    @Test
    void corsIsRestrictedToConfiguredBrowserOriginsAndHeaders() {
        var source = new SecurityConfiguration().corsConfigurationSource(
                "http://127.0.0.1:3000, http://localhost:3000");
        var request = new MockHttpServletRequest("OPTIONS", "/api/auth/register");
        request.addHeader("Origin", "http://127.0.0.1:3000");

        var configuration = source.getCorsConfiguration(request);

        assertThat(configuration).isNotNull();
        assertThat(configuration.getAllowedOrigins())
                .containsExactly("http://127.0.0.1:3000", "http://localhost:3000");
        assertThat(configuration.getAllowedMethods()).contains("POST", "OPTIONS");
        assertThat(configuration.getAllowedHeaders()).contains("Authorization", "Content-Type", "X-Request-ID");
    }

    @Test
    void corsRejectsUnconfiguredBrowserOrigins() {
        var source = new SecurityConfiguration().corsConfigurationSource("http://127.0.0.1:3000");
        var request = new MockHttpServletRequest("OPTIONS", "/api/auth/register");
        request.addHeader("Origin", "https://evil.example");

        var configuration = source.getCorsConfiguration(request);

        assertThat(configuration).isNotNull();
        assertThat(configuration.checkOrigin("https://evil.example")).isNull();
    }

    @Test
    void loadsUserUsingNormalizedUsernameAndCurrentRoles() {
        UserRepository users = org.mockito.Mockito.mock(UserRepository.class);
        when(users.findByUsername("alice_1"))
                .thenReturn(java.util.Optional.of(new User("alice_1", "01700000000", null, "encoded")));

        UserDetailsService service = new SecurityConfiguration().users(users);

        for (String presentedUsername : java.util.List.of(" Alice_1 ", "ALICE_1", "\tAlice_1\n")) {
            assertThat(service.loadUserByUsername(presentedUsername).getUsername()).isEqualTo("alice_1");
            assertThat(service.loadUserByUsername(presentedUsername).getAuthorities())
                    .extracting("authority").containsExactly("ROLE_CUSTOMER");
        }
    }
}
