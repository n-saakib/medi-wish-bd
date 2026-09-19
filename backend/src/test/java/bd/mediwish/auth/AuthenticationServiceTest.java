package bd.mediwish.auth;

import bd.mediwish.user.UserIdentifierNormalizer;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthenticationServiceTest {
    @Mock UserRepository users;
    @Mock PasswordEncoder passwords;
    @Mock SessionService sessions;
    @Mock AccessTokenCodec accessTokens;

    @Test
    void resolvesOneVerifiedMobileOrEmailCandidateAndReturnsSafeSessionData() {
        var user = new User("alice_1", "01700000000", "alice@example.com", "encoded");
        var session = new SessionService.SessionCredential(user.id(), UUID.randomUUID(), "raw-refresh", Instant.MAX);
        var properties = properties();
        when(users.findByUsername("alice@example.com")).thenReturn(Optional.empty());
        when(users.findByMobileAndMobileVerifiedTrue("Alice@Example.COM")).thenReturn(Optional.empty());
        when(users.findAllByEmail("alice@example.com")).thenReturn(List.of(user));
        when(passwords.matches("correct-password", "encoded")).thenReturn(true);
        when(sessions.create(user)).thenReturn(session);
        when(accessTokens.issue(user.id(), session.sessionId()))
                .thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900, Instant.MAX));

        var result = new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties).signIn(" Alice@Example.COM ", "correct-password");

        assertThat(result.accessToken()).isEqualTo("access");
        assertThat(result.refreshToken()).isEqualTo("raw-refresh");
        assertThat(result.user()).extracting("username", "mobile", "email", "mobileVerified")
                .containsExactly("alice_1", "01700000000", "alice@example.com", false);
        verify(passwords).matches("correct-password", "encoded");
    }

    @Test
    void rejectsAmbiguousEmailAfterUsingTheDummyVerifier() {
        var first = new User("alice_1", "01700000000", "shared@example.com", "first");
        var second = new User("alice_2", "01700000001", "shared@example.com", "second");
        var properties = properties();
        when(users.findByUsername("shared@example.com")).thenReturn(Optional.empty());
        when(users.findByMobileAndMobileVerifiedTrue("shared@example.com")).thenReturn(Optional.empty());
        when(users.findAllByEmail("shared@example.com")).thenReturn(List.of(first, second));

        assertThatThrownBy(() -> new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties).signIn("shared@example.com", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", properties.dummyPasswordVerifier());
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void rejectsUnknownIdentifierWithoutRevealingCandidateDetails() {
        var properties = properties();
        when(users.findByUsername("missing")).thenReturn(Optional.empty());
        when(users.findByMobileAndMobileVerifiedTrue("missing")).thenReturn(Optional.empty());
        when(users.findAllByEmail("missing")).thenReturn(List.of());

        assertThatThrownBy(() -> new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties).signIn("missing", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", properties.dummyPasswordVerifier());
    }

    private AuthProperties properties() {
        var properties = new AuthProperties();
        properties.setDummyPasswordVerifier("dummy-verifier");
        return properties;
    }
}
