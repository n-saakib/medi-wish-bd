package bd.mediwish.auth;

import bd.mediwish.user.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SessionServiceTest {
    private static final Instant NOW = Instant.parse("2026-09-19T10:00:00Z");
    @Mock UserSessionRepository sessions;
    @Mock UserSessionRefreshTokenRepository refreshTokens;

    @Test
    void createsGenerationZeroWithA32ByteOpaqueRefreshValue() {
        var random = new FixedRandom();
        var service = service(random);
        var user = new User("alice_1", "01700000000", null, "encoded");

        var result = service.create(user);

        assertThat(result.userId()).isEqualTo(user.id());
        assertThat(result.refreshToken()).isNotBlank();
        assertThat(java.util.Base64.getUrlDecoder().decode(result.refreshToken())).hasSize(32);
        var savedToken = captureSavedToken();
        assertThat(savedToken.generation()).isZero();
        assertThat(savedToken.tokenHash()).isEqualTo(RefreshTokenHasher.hash(result.refreshToken()));
    }

    @Test
    void rotatesOnceAndConsumesThePreviousGeneration() {
        var random = new FixedRandom();
        var service = service(random);
        var user = new User("alice_1", "01700000000", null, "encoded");
        var session = new UserSession(UUID.randomUUID(), user, NOW, NOW.plusSeconds(1000));
        String raw = "current-refresh";
        var current = new UserSessionRefreshToken(UUID.randomUUID(), session, 0,
                RefreshTokenHasher.hash(raw), NOW, session.expiresAt());
        when(refreshTokens.findByTokenHashForUpdate(current.tokenHash())).thenReturn(Optional.of(current));
        when(sessions.findByIdForUpdate(session.id())).thenReturn(Optional.of(session));

        var rotated = service.rotate(raw);

        assertThat(rotated.sessionId()).isEqualTo(session.id());
        assertThat(current.consumedAt()).isEqualTo(NOW);
        var saved = captureSavedTokens();
        assertThat(saved).anySatisfy(token -> assertThat(token.generation()).isEqualTo(1));
        assertThat(saved).anySatisfy(token -> assertThat(token.generation()).isZero());
    }

    @Test
    void replayRevokesTheWholeFamilyAndFailsGenerically() {
        var service = service(new FixedRandom());
        var user = new User("alice_1", "01700000000", null, "encoded");
        var session = new UserSession(UUID.randomUUID(), user, NOW, NOW.plusSeconds(1000));
        String raw = "already-used";
        var current = new UserSessionRefreshToken(UUID.randomUUID(), session, 0,
                RefreshTokenHasher.hash(raw), NOW, session.expiresAt());
        current.consume(NOW.minusSeconds(1));
        when(refreshTokens.findByTokenHashForUpdate(current.tokenHash())).thenReturn(Optional.of(current));
        when(sessions.findByIdForUpdate(session.id())).thenReturn(Optional.of(session));

        assertThatThrownBy(() -> service.rotate(raw)).isInstanceOf(SessionReplayException.class);
        assertThat(session.revoked()).isTrue();
        assertThat(session.revokedReason()).isEqualTo("refresh-replay");
    }

    @Test
    void revokesEveryActiveSessionFamilyForTheUser() {
        var service = service(new FixedRandom());
        var user = new User("alice_1", "01700000000", null, "encoded");
        var first = new UserSession(UUID.randomUUID(), user, NOW, NOW.plusSeconds(1000));
        var second = new UserSession(UUID.randomUUID(), user, NOW, NOW.plusSeconds(1000));
        when(sessions.findActiveByUserIdForUpdate(user.id())).thenReturn(List.of(first, second));

        service.revokeAllForUser(user.id(), "password-reset");

        assertThat(first.revoked()).isTrue();
        assertThat(first.revokedReason()).isEqualTo("password-reset");
        assertThat(second.revoked()).isTrue();
        assertThat(second.revokedReason()).isEqualTo("password-reset");
        ArgumentCaptor<UserSession> captor = ArgumentCaptor.forClass(UserSession.class);
        verify(sessions, times(2)).save(captor.capture());
        assertThat(captor.getAllValues()).containsExactlyInAnyOrder(first, second);
    }

    @Test
    void rejectsAnActiveSessionOwnedByAnotherUser() {
        var service = service(new FixedRandom());
        var sessionOwner = new User("session_owner", "01700000000", null, "encoded");
        var tokenUser = new User("token_user", "01700000001", null, "encoded");
        var session = new UserSession(UUID.randomUUID(), sessionOwner, NOW, NOW.plusSeconds(1000));
        when(sessions.findById(session.id())).thenReturn(Optional.of(session));

        assertThatThrownBy(() -> service.requireActive(session.id(), tokenUser.id(), NOW))
                .isInstanceOf(AuthenticationRequiredException.class);
    }

    private SessionService service(FixedRandom random) {
        var properties = new AuthProperties();
        properties.setRefreshTokenLifetime(java.time.Duration.ofSeconds(1000));
        return new SessionService(sessions, refreshTokens, properties,
                Clock.fixed(NOW, ZoneOffset.UTC), random);
    }

    private UserSessionRefreshToken captureSavedToken() {
        return captureSavedTokens().get(0);
    }

    private java.util.List<UserSessionRefreshToken> captureSavedTokens() {
        ArgumentCaptor<UserSessionRefreshToken> captor = ArgumentCaptor.forClass(UserSessionRefreshToken.class);
        verify(refreshTokens, atLeastOnce()).save(captor.capture());
        return captor.getAllValues();
    }

    private static final class FixedRandom extends java.security.SecureRandom {
        @Override
        public void nextBytes(byte[] bytes) {
            java.util.Arrays.fill(bytes, (byte) 7);
        }
    }
}
