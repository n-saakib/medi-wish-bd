package bd.mediwish.auth;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.security.SecureRandom;
import java.time.Clock;

@Configuration
@EnableConfigurationProperties(AuthProperties.class)
class AuthCoreConfiguration {
    /** Argon2id with a 16-byte salt, 32-byte hash, 19 MiB memory, 2 iterations and parallelism 1 (ADR-0019). */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new Argon2PasswordEncoder(16, 32, 1, 19_456, 2);
    }

    @Bean
    Clock authClock() {
        return Clock.systemUTC();
    }

    @Bean
    SecureRandom authSecureRandom() {
        return new SecureRandom();
    }
}
