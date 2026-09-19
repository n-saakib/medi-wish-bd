package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CurrentUserAuthenticationTest {
    @Mock AccessTokenCodec accessTokens;
    @Mock SessionService sessions;
    @Mock UserRepository users;

    @Test
    void loadsCurrentRolesAfterSessionAndTokenValidation() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        var user = new User("alice_1", "01700000000", null, "encoded");
        when(accessTokens.verify("access")).thenReturn(new AccessTokenCodec.AccessTokenClaims(
                userId, sessionId, UUID.randomUUID(), Instant.EPOCH, Instant.MAX, "medi-wish", "medi-wish-api", "access+jwt"));
        when(users.findById(userId)).thenReturn(Optional.of(user));

        var current = new CurrentUserAuthentication(accessTokens, sessions, users,
                Clock.fixed(Instant.parse("2026-09-19T10:00:00Z"), ZoneOffset.UTC)).authenticate("access");

        assertThat(current.username()).isEqualTo("alice_1");
        assertThat(current.roles()).containsExactly(UserRole.CUSTOMER);
        verify(sessions).requireActive(eq(sessionId), eq(userId), any());
    }
}
