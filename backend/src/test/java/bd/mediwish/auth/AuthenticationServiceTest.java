package bd.mediwish.auth;

import bd.mediwish.user.UserIdentifierNormalizer;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
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
    private static final String VALID_VERIFIER =
            "$argon2id$v=19$m=16384,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    @Mock UserRepository users;
    @Mock PasswordEncoder passwords;
    @Mock SessionService sessions;
    @Mock AccessTokenCodec accessTokens;

    @Test
    void resolvesOneVerifiedMobileOrEmailCandidateAndReturnsSafeSessionData() {
        var user = new User("alice_1", "01700000000", "alice@example.com", VALID_VERIFIER);
        var session = new SessionService.SessionCredential(user.id(), UUID.randomUUID(), "raw-refresh", Instant.MAX);
        var properties = properties();
        when(users.findByUsername("alice@example.com")).thenReturn(Optional.empty());
        when(users.findByMobileAndMobileVerifiedTrue("Alice@Example.COM")).thenReturn(Optional.empty());
        when(users.findTop2ByEmailIgnoreCase("alice@example.com")).thenReturn(List.of(user));
        when(passwords.matches("correct-password", VALID_VERIFIER)).thenReturn(true);
        when(sessions.create(user)).thenReturn(session);
        when(accessTokens.issue(user.id(), session.sessionId()))
                .thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900, Instant.MAX));

        var result = new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties).signIn(" Alice@Example.COM ", "correct-password");

        assertThat(result.accessToken()).isEqualTo("access");
        assertThat(result.refreshToken()).isEqualTo("raw-refresh");
        assertThat(result.refreshExpiresAt()).isEqualTo(session.expiresAt());
        assertThat(result.user()).extracting("username", "mobile", "email", "mobileVerified")
                .containsExactly("alice_1", "01700000000", "alice@example.com", false);
        verify(passwords).matches("correct-password", VALID_VERIFIER);
    }

    @Test
    void rejectsUnusablePersistedVerifierAfterDummyVerificationWithoutCreatingASession() {
        var user = new User("alice_1", "01700000000", null, "not-an-argon2-verifier");
        var properties = properties();
        when(users.findByUsername("alice_1")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties).signIn("alice_1", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);

        verify(passwords).matches("candidate-password", properties.dummyPasswordVerifier());
        verify(passwords, never()).matches(anyString(), eq("not-an-argon2-verifier"));
        verify(sessions, never()).create(any());
        verifyNoInteractions(accessTokens);
    }

    @Test
    void rejectsAmbiguousEmailAfterUsingTheDummyVerifier() {
        var first = new User("alice_1", "01700000000", "shared@example.com", "first");
        var second = new User("alice_2", "01700000001", "shared@example.com", "second");
        var properties = properties();
        when(users.findByUsername("shared@example.com")).thenReturn(Optional.empty());
        when(users.findByMobileAndMobileVerifiedTrue("shared@example.com")).thenReturn(Optional.empty());
        when(users.findTop2ByEmailIgnoreCase("shared@example.com")).thenReturn(List.of(first, second));

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
        when(users.findTop2ByEmailIgnoreCase("missing")).thenReturn(List.of());

        assertThatThrownBy(() -> new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties).signIn("missing", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", properties.dummyPasswordVerifier());
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", " ", "not-an-argon2-verifier"})
    void refreshRejectsUnusablePersistedVerifierAndRevokesRotatedFamily(String passwordHash) {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        var rotated = new SessionService.SessionCredential(userId, sessionId, "next-refresh", Instant.MAX);
        var user = new User("alice_1", "01700000000", null, passwordHash);
        when(sessions.rotate("presented-refresh")).thenReturn(rotated);
        when(users.findById(userId)).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties()).refresh("presented-refresh"))
                .isInstanceOf(AuthenticationRequiredException.class);

        verify(sessions).revoke(sessionId, "user-unavailable");
        verifyNoInteractions(accessTokens);
    }

    @Test
    void refreshIssuesAccessTokenForAUsablePersistedVerifier() {
        UUID sessionId = UUID.randomUUID();
        var user = new User("alice_1", "01700000000", null, VALID_VERIFIER);
        UUID userId = user.id();
        var rotated = new SessionService.SessionCredential(userId, sessionId, "next-refresh", Instant.MAX);
        when(sessions.rotate("presented-refresh")).thenReturn(rotated);
        when(users.findById(userId)).thenReturn(Optional.of(user));
        when(accessTokens.issue(userId, sessionId))
                .thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900, Instant.MAX));

        var result = new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties()).refresh("presented-refresh");

        assertThat(result.accessToken()).isEqualTo("access");
        assertThat(result.refreshToken()).isEqualTo("next-refresh");
        assertThat(result.refreshExpiresAt()).isEqualTo(rotated.expiresAt());
        verify(sessions, never()).revoke(any(), anyString());
    }

    @Test
    void logoutRevokesMultipleRefreshTokensInStableOrder() {
        var service = new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions,
                accessTokens, properties());

        service.logout(List.of("refresh-z", "refresh-a"));

        var revocations = inOrder(sessions);
        revocations.verify(sessions).revokeByRefreshToken("refresh-a", "logout");
        revocations.verify(sessions).revokeByRefreshToken("refresh-z", "logout");
        verifyNoMoreInteractions(sessions);
    }

    private AuthProperties properties() {
        var properties = new AuthProperties();
        properties.setDummyPasswordVerifier("dummy-verifier");
        return properties;
    }
}
