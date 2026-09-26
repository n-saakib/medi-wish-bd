package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.springframework.security.authorization.AuthorityAuthorizationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CurrentUserAuthenticationTest {
    private static final String VALID_VERIFIER =
            "$argon2id$v=19$m=16384,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    @Mock AccessTokenCodec accessTokens;
    @Mock SessionService sessions;
    @Mock UserRepository users;

    @Test
    void loadsCurrentRolesAfterSessionAndTokenValidation() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        var user = new User("alice_1", "01700000000", null, VALID_VERIFIER);
        when(accessTokens.verify("access")).thenReturn(new AccessTokenCodec.AccessTokenClaims(
                userId, sessionId, UUID.randomUUID(), Instant.EPOCH, Instant.MAX, "medi-wish", "medi-wish-api", "access+jwt"));
        when(users.findById(userId)).thenReturn(Optional.of(user));

        var current = new CurrentUserAuthentication(accessTokens, sessions, users,
                Clock.fixed(Instant.parse("2026-09-19T10:00:00Z"), ZoneOffset.UTC)).authenticate("access");

        assertThat(current.username()).isEqualTo("alice_1");
        assertThat(current.roles()).containsExactly(UserRole.CUSTOMER);
        verify(sessions).requireActive(eq(sessionId), eq(userId), any());
    }

    @Test
    void missingCurrentRoleIsForbiddenButUnusableUserIsUnauthenticated() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        var claims = new AccessTokenCodec.AccessTokenClaims(
                userId, sessionId, UUID.randomUUID(), Instant.EPOCH, Instant.MAX,
                "medi-wish", "medi-wish-api", "access+jwt");
        when(accessTokens.verify("access")).thenReturn(claims);
        var user = mock(User.class);
        when(user.id()).thenReturn(userId);
        when(user.username()).thenReturn("alice_1");
        when(user.mobile()).thenReturn("01700000000");
        when(user.email()).thenReturn(null);
        when(user.mobileVerified()).thenReturn(false);
        when(user.passwordHash()).thenReturn(VALID_VERIFIER);
        when(user.roles()).thenReturn(Set.of());
        when(users.findById(userId)).thenReturn(Optional.of(user));

        var current = new CurrentUserAuthentication(accessTokens, sessions, users,
                Clock.fixed(Instant.parse("2026-09-19T10:00:00Z"), ZoneOffset.UTC)).authenticate("access");
        var authentication = new UsernamePasswordAuthenticationToken(current, null,
                current.roles().stream().map(role -> new SimpleGrantedAuthority("ROLE_" + role.name())).toList());
        var decision = AuthorityAuthorizationManager.<Object>hasRole(UserRole.CUSTOMER.name())
                .authorize(() -> authentication, new Object());

        assertThat(current.roles()).isEmpty();
        assertThat(current.mobileVerified()).isFalse();
        assertThat(authentication.isAuthenticated()).isTrue();
        assertThat(decision).isNotNull();
        assertThat(decision.isGranted()).isFalse();

    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", " ", "not-an-argon2-verifier"})
    void rejectsMissingOrMalformedPersistedVerifier(String passwordHash) {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        var user = new User("alice_1", "01700000000", null, passwordHash);
        when(users.findById(userId)).thenReturn(Optional.of(user));
        when(accessTokens.verify("access")).thenReturn(new AccessTokenCodec.AccessTokenClaims(
                userId, sessionId, UUID.randomUUID(), Instant.EPOCH, Instant.MAX,
                "medi-wish", "medi-wish-api", "access+jwt"));

        assertThatThrownBy(() -> new CurrentUserAuthentication(accessTokens, sessions, users,
                Clock.fixed(Instant.parse("2026-09-19T10:00:00Z"), ZoneOffset.UTC)).authenticate("access"))
                .isInstanceOf(AuthenticationRequiredException.class);
    }
}
