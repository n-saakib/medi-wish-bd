package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.User;
import bd.mediwish.user.UserIdentifierNormalizer;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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

    private static final Instant NOW = Instant.parse("2026-09-27T10:00:00Z");
    private static final SessionService.MfaEvidence PASSWORD_ONLY = new SessionService.MfaEvidence(null, null);

    @Mock UserRepository users;
    @Mock PasswordEncoder passwords;
    @Mock SessionService sessions;
    @Mock AccessTokenCodec accessTokens;
    @Mock StaffMfaFactorRepository factors;
    private AuthenticationService service;

    @BeforeEach
    void setUp() {
        when(passwords.encode(anyString())).thenReturn(DUMMY_VERIFIER);
        service = service(passwords);
    }

    private AuthenticationService service(PasswordEncoder encoder) {
        return new AuthenticationService(users, encoder, new UserIdentifierNormalizer(), sessions, accessTokens, factors,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void signsInTheOneUserAnIdentifierNamesAndReturnsItsProfile() {
        var user = new User("alice_1", "01700000000", "alice@example.com", VALID_VERIFIER);
        var session = new SessionService.SessionCredential(user.id(), UUID.randomUUID(), "raw-refresh", Instant.MAX,
                PASSWORD_ONLY);
        lookups(" Alice@Example.COM ", null, null, user);
        when(passwords.matches("correct-password", VALID_VERIFIER)).thenReturn(true);
        when(sessions.create(user.id())).thenReturn(new SessionService.PasswordSession(user, session));
        when(accessTokens.issue(user.id(), session.sessionId())).thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900));

        var result = service.signIn(" Alice@Example.COM ", "correct-password");

        assertThat(result).isEqualTo(new AuthenticationService.AuthenticatedSession("access", 900, "raw-refresh",
                Instant.MAX, new UserProfile("alice_1", "01700000000", "alice@example.com", false), MfaStatus.NOT_REQUIRED));
    }

    @Test
    void aStaffPasswordSignInGetsOnlyARestrictedSessionThatMustStillEnroll() {
        var user = new User("owner_1", "01700000000", null, VALID_VERIFIER);
        user.replaceRole(UserRole.ADMIN);
        var session = new SessionService.SessionCredential(user.id(), UUID.randomUUID(), "raw-refresh",
                NOW.plus(Duration.ofMinutes(10)), PASSWORD_ONLY);
        lookups("owner_1", user, null, null);
        when(passwords.matches("correct-password", VALID_VERIFIER)).thenReturn(true);
        when(sessions.create(user.id())).thenReturn(new SessionService.PasswordSession(user, session));
        when(accessTokens.issue(user.id(), session.sessionId())).thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900));

        var result = service.signIn("owner_1", "correct-password");

        assertThat(result.mfa()).isEqualTo(MfaStatus.ENROLLMENT_REQUIRED);
        assertThat(result.expiresIn()).as("the access token is usable only while the session lives").isEqualTo(600);
        assertThat(result.refreshExpiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(10)));
    }

    @Test
    void signInIssuesFromTheUserReadUnderTheSessionLockInsteadOfThePasswordLookup() {
        var unlocked = new User("changed_role", "01700000000", null, VALID_VERIFIER);
        var locked = spy(unlocked);
        when(locked.role()).thenReturn(UserRole.MODERATOR);
        lookups("changed_role", unlocked, null, null);
        when(passwords.matches("correct-password", VALID_VERIFIER)).thenReturn(true);
        var credential = new SessionService.SessionCredential(unlocked.id(), UUID.randomUUID(), "refresh",
                NOW.plus(Duration.ofMinutes(10)), PASSWORD_ONLY);
        when(sessions.create(unlocked.id())).thenReturn(new SessionService.PasswordSession(locked, credential));
        when(accessTokens.issue(unlocked.id(), credential.sessionId()))
                .thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900));
        assertThat(service.signIn("changed_role", "correct-password").mfa()).isEqualTo(MfaStatus.ENROLLMENT_REQUIRED);
    }
    @Test
    void aWrongPasswordFailsWithoutASession() {
        var user = new User("alice_1", "01700000000", null, VALID_VERIFIER);
        lookups("alice_1", user, null, null);

        assertThatThrownBy(() -> service.signIn("alice_1", "wrong-password")).isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("wrong-password", VALID_VERIFIER);
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void anUnknownIdentifierIsComparedAgainstTheDummyVerifier() {
        lookups("missing", null, null, null);

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
        when(users.findByEmailIgnoreCase("01700000000")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.signIn("01700000000", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", DUMMY_VERIFIER);
        verify(passwords, never()).matches(anyString(), eq(VALID_VERIFIER));
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void aBlankIdentifierNeverLooksUpAMissingEmailAndFailsAgainstTheDummyVerifier() {
        when(users.findByUsername("")).thenReturn(Optional.empty());
        when(users.findByMobileAndMobileVerifiedTrue("")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.signIn("   ", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(users, never()).findByEmailIgnoreCase(any());
        verify(passwords).matches("candidate-password", DUMMY_VERIFIER);
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void anUnusablePersistedVerifierIsNeverHashedAndFailsAgainstTheDummy() {
        var user = new User("alice_1", "01700000000", null, "not-an-argon2-verifier");
        lookups("alice_1", user, null, null);

        assertThatThrownBy(() -> service.signIn("alice_1", "candidate-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verify(passwords).matches("candidate-password", DUMMY_VERIFIER);
        verify(passwords, never()).matches(anyString(), eq("not-an-argon2-verifier"));
        verifyNoInteractions(sessions, accessTokens);
    }

    @Test
    void theDummyVerifierIsGeneratedAtStartupWithTheProductionEncoder() {
        PasswordEncoder production = spy(new AuthCoreConfiguration().passwordEncoder());
        lookups("missing", null, null, null);

        var realService = service(production);
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
                .thenReturn(new SessionService.SessionCredential(userId, sessionId, "next-refresh", Instant.MAX,
                        PASSWORD_ONLY));
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
                .thenReturn(new SessionService.SessionCredential(user.id(), sessionId, "next-refresh", Instant.MAX,
                        PASSWORD_ONLY));
        when(users.findById(user.id())).thenReturn(Optional.of(user));
        when(accessTokens.issue(user.id(), sessionId)).thenReturn(new AccessTokenCodec.IssuedAccessToken("access", 900));

        var result = service.refresh("presented-refresh");

        assertThat(result.accessToken()).isEqualTo("access");
        assertThat(result.refreshToken()).isEqualTo("next-refresh");
        assertThat(result.mfa()).isEqualTo(MfaStatus.NOT_REQUIRED);
        verify(sessions, never()).revoke(any(), any());
    }

    @Test
    void logoutRevokesTheSessionsOfEveryPresentedCookie() {
        service.logout(List.of("refresh-z", "refresh-a"));

        verify(sessions).revokeByRefreshTokens(List.of("refresh-z", "refresh-a"), RevocationReason.LOGOUT);
        verifyNoMoreInteractions(sessions);
    }

    private void lookups(String identifier, User byUsername, User byMobile, User byEmail) {
        String normalized = identifier.trim().toLowerCase(java.util.Locale.ROOT);
        when(users.findByUsername(normalized)).thenReturn(Optional.ofNullable(byUsername));
        when(users.findByMobileAndMobileVerifiedTrue(identifier.trim())).thenReturn(Optional.ofNullable(byMobile));
        when(users.findByEmailIgnoreCase(normalized)).thenReturn(Optional.ofNullable(byEmail));
    }
}
