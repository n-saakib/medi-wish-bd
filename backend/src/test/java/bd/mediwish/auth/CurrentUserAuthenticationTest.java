package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CurrentUserAuthenticationTest {
    private static final Instant NOW = Instant.parse("2026-09-19T10:00:00Z");
    private static final String VALID_VERIFIER =
            "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final SessionService.MfaEvidence PASSWORD_ONLY = new SessionService.MfaEvidence(null, null);

    @Mock AccessTokenCodec accessTokens;
    @Mock SessionService sessions;
    @Mock UserRepository users;
    @Mock StaffMfaFactorRepository factors;
    private CurrentUserAuthentication currentUsers;

    @BeforeEach
    void setUp() {
        currentUsers = new CurrentUserAuthentication(accessTokens, sessions, users, factors,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void resolvesTheProfileAndCurrentRolesOfAnActiveSession() {
        when(accessTokens.verify("access")).thenReturn(new AccessTokenCodec.AccessTokenClaims(USER_ID, SESSION_ID));
        when(sessions.requireActive(SESSION_ID, USER_ID, NOW)).thenReturn(PASSWORD_ONLY);
        when(users.findById(USER_ID)).thenReturn(Optional.of(new User("alice_1", "01700000000", null, VALID_VERIFIER)));

        var current = currentUsers.authenticate("access");

        assertThat(current.profile()).isEqualTo(new UserProfile("alice_1", "01700000000", null, false));
        assertThat(current.roles()).containsExactly(UserRole.CUSTOMER);
        assertThat(current.mfa()).isEqualTo(MfaStatus.NOT_REQUIRED);
        assertThat(current.authorities()).containsExactly("ROLE_CUSTOMER");
    }

    @Test
    void aStaffSessionIsGrantedItsRolesOnlyWhileItCarriesEvidenceForTheActiveAuthenticator() {
        var admin = new User("owner_1", "01700000000", null, VALID_VERIFIER);
        admin.replaceRole(UserRole.ADMIN);
        UUID factorId = UUID.randomUUID();
        when(accessTokens.verify("access")).thenReturn(new AccessTokenCodec.AccessTokenClaims(USER_ID, SESSION_ID));
        when(users.findById(USER_ID)).thenReturn(Optional.of(admin));
        when(factors.activeFactorIdOf(admin)).thenReturn(factorId);

        when(sessions.requireActive(SESSION_ID, USER_ID, NOW)).thenReturn(PASSWORD_ONLY);
        assertThat(currentUsers.authenticate("access").authorities()).containsExactly(StaffAccessPolicy.MFA_CHALLENGE);

        when(sessions.requireActive(SESSION_ID, USER_ID, NOW))
                .thenReturn(new SessionService.MfaEvidence(factorId, NOW.minusSeconds(60)));
        var verified = currentUsers.authenticate("access");
        assertThat(verified.mfa()).isEqualTo(MfaStatus.VERIFIED);
        assertThat(verified.authorities()).containsExactly("ROLE_ADMIN");
    }

    @Test
    void aRevokedOrExpiredSessionIsRejectedBeforeTheUserIsRead() {
        when(accessTokens.verify("access")).thenReturn(new AccessTokenCodec.AccessTokenClaims(USER_ID, SESSION_ID));
        doThrow(new AuthenticationRequiredException()).when(sessions).requireActive(SESSION_ID, USER_ID, NOW);

        assertThatThrownBy(() -> currentUsers.authenticate("access")).isInstanceOf(AuthenticationRequiredException.class);
        verifyNoInteractions(users);
    }

    @Test
    void anInvalidTokenIsRejectedBeforeTheSessionIsRead() {
        when(accessTokens.verify("forged")).thenThrow(new AuthenticationRequiredException());

        assertThatThrownBy(() -> currentUsers.authenticate("forged")).isInstanceOf(AuthenticationRequiredException.class);
        verifyNoInteractions(sessions, users);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-an-argon2-verifier"})
    void aUserWithAnUnusablePersistedVerifierIsUnauthenticated(String passwordHash) {
        when(accessTokens.verify("access")).thenReturn(new AccessTokenCodec.AccessTokenClaims(USER_ID, SESSION_ID));
        when(sessions.requireActive(SESSION_ID, USER_ID, NOW)).thenReturn(PASSWORD_ONLY);
        when(users.findById(USER_ID)).thenReturn(Optional.of(new User("alice_1", "01700000000", null, passwordHash)));

        assertThatThrownBy(() -> currentUsers.authenticate("access")).isInstanceOf(AuthenticationRequiredException.class);
    }
}
