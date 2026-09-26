package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserIdentifierNormalizer;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthenticationServiceTest {
    private static final String VALID_VERIFIER =
            "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private static final String DUMMY_VERIFIER = "dummy-verifier";

    @Mock UserRepository users;
    @Mock PasswordEncoder passwords;
    @Mock SessionService sessions;
    @Mock AccessTokenCodec accessTokens;
    private AuthenticationService service;

    @BeforeEach
    void setUp() {
        when(passwords.encode(anyString())).thenReturn(DUMMY_VERIFIER);
        service = new AuthenticationService(users, passwords, new UserIdentifierNormalizer(), sessions, accessTokens);
    }

    @Test
    void signsInTheOneUserAnIdentifierNamesAndReturnsItsProfile() {
        var user = new User("alice_1", "01700000000", "alice@example.com", VALID_VERIFIER);
        var session = new SessionService.SessionCredential(user.id(), UUID.randomUUID(), "raw-refresh", Instant.MAX);
        lookups(" Alice@Example.COM ", null, null, List.of(user));
        when(passwords.matches("correct-password", VALID_VERIFIER)).thenReturn(true);
        when(sessions.create(user)).thenReturn(session);
        when(accessTokens.issue(user.id(), session.sessionId())).thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900));

        var result = service.signIn(" Alice@Example.COM ", "correct-password");

        assertThat(result).isEqualTo(new AuthenticationService.AuthenticatedSession("access", 900, "raw-refresh",
                Instant.MAX, new UserProfile("alice_1", "01700000000", "alice@example.com", false)));
    }

    @Test
    void aWrongPasswordFailsWithoutASession() {
        var user = new User("alice_1", "01700000000", null, VALID_VERIFIER);
        lookups("alice_1", user, null, List.of());

        assertThatThrownBy(() -> service.signIn("alice_1", "wrong-password")).isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("wrong-password", VALID_VERIFIER);
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void anUnknownIdentifierIsComparedAgainstTheDummyVerifier() {
        lookups("missing", null, null, List.of());

        assertThatThrownBy(() -> service.signIn("missing", "candidate-password")).isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", DUMMY_VERIFIER);
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void anIdentifierMatchingTwoUsersAcrossFieldsFailsWhateverThePassword() {
        // A legacy username from before the letter rule equals another User's verified mobile: neither may win.
        var usernameOwner = new User("01700000000", "01800000000", null, VALID_VERIFIER);
        var mobileOwner = new User("bob_1", "01700000000", null, VALID_VERIFIER);
        when(users.findByUsername("01700000000")).thenReturn(Optional.of(usernameOwner));
        when(users.findByMobileAndMobileVerifiedTrue("01700000000")).thenReturn(Optional.of(mobileOwner));
        when(users.findTop2ByEmailIgnoreCase("01700000000")).thenReturn(List.of());

        assertThatThrownBy(() -> service.signIn("01700000000", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", DUMMY_VERIFIER);
        verify(passwords, never()).matches(anyString(), eq(VALID_VERIFIER));
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void anEmailSharedByTwoUsersFailsAgainstTheDummyVerifier() {
        var first = new User("alice_1", "01700000000", "shared@example.com", VALID_VERIFIER);
        var second = new User("alice_2", "01700000001", "shared@example.com", VALID_VERIFIER);
        lookups("shared@example.com", null, null, List.of(first, second));

        assertThatThrownBy(() -> service.signIn("shared@example.com", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", DUMMY_VERIFIER);
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void anUnusablePersistedVerifierIsNeverHashedAndFailsAgainstTheDummy() {
        var user = new User("alice_1", "01700000000", null, "not-an-argon2-verifier");
        lookups("alice_1", user, null, List.of());

        assertThatThrownBy(() -> service.signIn("alice_1", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", DUMMY_VERIFIER);
        verify(passwords, never()).matches(anyString(), eq("not-an-argon2-verifier"));
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void theDummyVerifierIsGeneratedAtStartupWithTheProductionEncoder() {
        PasswordEncoder production = spy(new AuthCoreConfiguration().passwordEncoder());
        lookups("missing", null, null, List.of());

        var realService = new AuthenticationService(users, production, new UserIdentifierNormalizer(), sessions, accessTokens);
        assertThatThrownBy(() -> realService.signIn("missing", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);

        var verifier = ArgumentCaptor.forClass(String.class);
        verify(production).matches(eq("candidate-password"), verifier.capture());
        assertThat(verifier.getValue()).startsWith("$argon2id$v=19$m=19456,t=2,p=1$");
        assertThat(PasswordVerifierPolicy.isUsable(verifier.getValue())).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-an-argon2-verifier"})
    void refreshRevokesTheRotatedSessionWhenTheUserCanNoLongerSignIn(String passwordHash) {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        when(sessions.rotate("presented-refresh"))
                .thenReturn(new SessionService.SessionCredential(userId, sessionId, "next-refresh", Instant.MAX));
        when(users.findById(userId)).thenReturn(Optional.of(new User("alice_1", "01700000000", null, passwordHash)));

        assertThatThrownBy(() -> service.refresh("presented-refresh")).isInstanceOf(AuthenticationRequiredException.class);

        verify(sessions).revoke(sessionId, RevocationReason.USER_UNAVAILABLE);
        verifyNoInteractions(accessTokens);
    }

    @Test
    void refreshIssuesAnAccessTokenForTheRotatedSession() {
        var user = new User("alice_1", "01700000000", null, VALID_VERIFIER);
        UUID sessionId = UUID.randomUUID();
        when(sessions.rotate("presented-refresh"))
                .thenReturn(new SessionService.SessionCredential(user.id(), sessionId, "next-refresh", Instant.MAX));
        when(users.findById(user.id())).thenReturn(Optional.of(user));
        when(accessTokens.issue(user.id(), sessionId)).thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900));

        var result = service.refresh("presented-refresh");

        assertThat(result.accessToken()).isEqualTo("access");
        assertThat(result.refreshToken()).isEqualTo("next-refresh");
        verify(sessions, never()).revoke(any(), any());
    }

    @Test
    void logoutRevokesDuplicatedCookiesInAFixedOrderSoConcurrentLogoutsCannotDeadlock() {
        service.logout(List.of("refresh-z", "refresh-a"));

        var revocations = inOrder(sessions);
        revocations.verify(sessions).revokeByRefreshToken("refresh-a", RevocationReason.LOGOUT);
        revocations.verify(sessions).revokeByRefreshToken("refresh-z", RevocationReason.LOGOUT);
        verifyNoMoreInteractions(sessions);
    }

    private void lookups(String identifier, User byUsername, User byMobile, List<User> byEmail) {
        String normalized = identifier.trim().toLowerCase(java.util.Locale.ROOT);
        when(users.findByUsername(normalized)).thenReturn(Optional.ofNullable(byUsername));
        when(users.findByMobileAndMobileVerifiedTrue(identifier.trim())).thenReturn(Optional.ofNullable(byMobile));
        when(users.findTop2ByEmailIgnoreCase(normalized)).thenReturn(byEmail);
    }
}
