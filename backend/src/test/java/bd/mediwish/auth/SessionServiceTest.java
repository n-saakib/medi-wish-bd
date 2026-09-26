package bd.mediwish.auth;

import bd.mediwish.user.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SessionServiceTest {
    private static final Instant NOW = Instant.parse("2026-09-19T10:00:00Z");
    private static final String PRESENTED = "presented-refresh";

    @Mock UserSessionRepository sessions;
    @Mock UserSessionRefreshTokenRepository refreshTokens;
    private SessionService service;
    private final User user = new User("alice_1", "01700000000", null, "encoded");

    @BeforeEach
    void setUp() {
        var properties = new AuthProperties(Duration.ofMinutes(15), Duration.ofSeconds(1000), "medi-wish",
                "medi-wish-api", "unused", new AuthProperties.Cookie(true));
        var random = new SecureRandom() {
            @Override
            public void nextBytes(byte[] bytes) {
                Arrays.fill(bytes, (byte) 7);
            }
        };
        service = new SessionService(sessions, refreshTokens, properties, Clock.fixed(NOW, ZoneOffset.UTC), random);
    }

    @Test
    void createsGenerationZeroStoringOnlyTheHashOfA32ByteRefreshValue() {
        var result = service.create(user);

        assertThat(result.userId()).isEqualTo(user.id());
        assertThat(result.expiresAt()).isEqualTo(NOW.plusSeconds(1000));
        assertThat(Base64.getUrlDecoder().decode(result.refreshToken())).hasSize(32);
        var saved = savedTokens().getFirst();
        assertThat(saved.generation()).isZero();
        assertThat(saved.tokenHash()).isEqualTo(RefreshTokenHasher.hash(result.refreshToken()));
    }

    @Test
    void rotationConsumesThePresentedGenerationAndIssuesTheNextForTheRemainingLifetime() {
        var session = session(NOW.plusSeconds(500));
        var current = presented(session);

        var rotated = service.rotate(PRESENTED);

        assertThat(rotated.sessionId()).isEqualTo(session.id());
        assertThat(rotated.expiresAt()).isEqualTo(session.expiresAt());
        assertThat(current.consumed()).isTrue();
        assertThat(savedTokens()).extracting(UserSessionRefreshToken::generation).containsExactly(0L, 1L);
        assertThat(savedTokens().get(1).tokenHash()).isEqualTo(RefreshTokenHasher.hash(rotated.refreshToken()));
    }

    @Test
    void replayingAConsumedGenerationRevokesTheFamily() {
        var session = session(NOW.plusSeconds(500));
        presented(session).consume(NOW.minusSeconds(1));

        assertThatThrownBy(() -> service.rotate(PRESENTED)).isInstanceOf(SessionReplayException.class);
        assertThat(session.revokedReason()).isEqualTo("refresh-replay");
        verify(sessions).save(session);
    }

    @Test
    void anUnknownRevokedOrExpiredRefreshIsRejectedWithoutRotating() {
        when(refreshTokens.findByTokenHashForUpdate(RefreshTokenHasher.hash("unknown"))).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.rotate("unknown")).isInstanceOf(AuthenticationRequiredException.class);

        var revoked = session(NOW.plusSeconds(500));
        revoked.revoke(NOW, RevocationReason.LOGOUT);
        presented(revoked);
        assertThatThrownBy(() -> service.rotate(PRESENTED)).isInstanceOf(AuthenticationRequiredException.class);

        presented(session(NOW));
        assertThatThrownBy(() -> service.rotate(PRESENTED)).isInstanceOf(AuthenticationRequiredException.class);

        verify(refreshTokens, never()).save(any());
    }

    @Test
    void revokingByRefreshTokensLocksTheirSessionsByHashAndRevokesEach() {
        var first = session(NOW.plusSeconds(500));
        var second = session(NOW.plusSeconds(500));
        when(sessions.findByRefreshTokenHashesForUpdate(
                List.of(RefreshTokenHasher.hash(PRESENTED), RefreshTokenHasher.hash("unknown"))))
                .thenReturn(List.of(first, second));

        service.revokeByRefreshTokens(List.of(PRESENTED, "unknown"), RevocationReason.LOGOUT);

        assertThat(List.of(first, second)).allSatisfy(session ->
                assertThat(session.revokedReason()).isEqualTo("logout"));
        verify(sessions).save(first);
        verify(sessions).save(second);
        verifyNoInteractions(refreshTokens);
    }

    @Test
    void revokingNoRefreshTokensQueriesNothing() {
        service.revokeByRefreshTokens(List.of(), RevocationReason.LOGOUT);

        verifyNoInteractions(sessions, refreshTokens);
    }

    @Test
    void revokesEveryActiveSessionOfTheUser() {
        var first = session(NOW.plusSeconds(500));
        var second = session(NOW.plusSeconds(500));
        when(sessions.findActiveByUserIdForUpdate(user.id())).thenReturn(List.of(first, second));

        service.revokeAllForUser(user.id(), RevocationReason.USER_UNAVAILABLE);

        assertThat(List.of(first, second)).allSatisfy(session ->
                assertThat(session.revokedReason()).isEqualTo("user-unavailable"));
        var saved = ArgumentCaptor.forClass(UserSession.class);
        verify(sessions, times(2)).save(saved.capture());
        assertThat(saved.getAllValues()).containsExactly(first, second);
    }

    @Test
    void anActiveSessionMustBelongToTheTokenUserAndBeUnrevokedAndUnexpired() {
        var active = session(NOW.plusSeconds(1));
        var revoked = session(NOW.plusSeconds(500));
        revoked.revoke(NOW, RevocationReason.LOGOUT);
        var expired = session(NOW);
        for (var session : List.of(active, revoked, expired)) {
            when(sessions.findById(session.id())).thenReturn(Optional.of(session));
        }

        service.requireActive(active.id(), user.id(), NOW);
        for (var rejected : List.of(
                (Runnable) () -> service.requireActive(active.id(), UUID.randomUUID(), NOW),
                () -> service.requireActive(revoked.id(), user.id(), NOW),
                () -> service.requireActive(expired.id(), user.id(), NOW),
                () -> service.requireActive(UUID.randomUUID(), user.id(), NOW))) {
            assertThatThrownBy(rejected::run).isInstanceOf(AuthenticationRequiredException.class);
        }
    }

    private UserSession session(Instant expiresAt) {
        return new UserSession(UUID.randomUUID(), user, NOW.minusSeconds(100), expiresAt);
    }

    private UserSessionRefreshToken presented(UserSession session) {
        var token = new UserSessionRefreshToken(UUID.randomUUID(), session, 0, RefreshTokenHasher.hash(PRESENTED),
                NOW.minusSeconds(100), session.expiresAt());
        when(refreshTokens.findByTokenHashForUpdate(token.tokenHash())).thenReturn(Optional.of(token));
        when(sessions.findByIdForUpdate(session.id())).thenReturn(Optional.of(session));
        return token;
    }

    private List<UserSessionRefreshToken> savedTokens() {
        var saved = ArgumentCaptor.forClass(UserSessionRefreshToken.class);
        verify(refreshTokens, org.mockito.Mockito.atLeastOnce()).save(saved.capture());
        return saved.getAllValues();
    }
}
