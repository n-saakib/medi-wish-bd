package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
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

    @Mock UserRepository users;
    @Mock UserSessionRepository sessions;
    @Mock UserSessionRefreshTokenRepository refreshTokens;
    private SessionService service;
    private final User user = new User("alice_1", "01700000000", null, "encoded");

    @BeforeEach
    void setUp() {
        var properties = new AuthProperties(Duration.ofMinutes(15), Duration.ofSeconds(1000), "medi-wish",
                "medi-wish-api", "unused", new AuthProperties.Cookie(true), TestAuthSettings.mfa(), TestAuthSettings.recovery());
        var random = new SecureRandom() {
            @Override
            public void nextBytes(byte[] bytes) {
                Arrays.fill(bytes, (byte) 7);
            }
        };
        service = new SessionService(users, sessions, refreshTokens, properties, Clock.fixed(NOW, ZoneOffset.UTC), random);
    }

    @Test void anEmailChangeRevokesOtherSessionsAndKeepsTheRequestingSessionActive() {
        var kept = session(NOW.plusSeconds(500));
        var other = session(NOW.plusSeconds(500));
        when(sessions.findActiveByUserIdForUpdate(user.id())).thenReturn(List.of(kept, other));
        service.revokeOthersForUser(user.id(), kept.id(), RevocationReason.EMAIL_CHANGED);
        assertThat(kept.revoked()).isFalse();
        assertThat(other.revokedReason()).isEqualTo("email-changed");
        verifyNoInteractions(refreshTokens);
    }

    @Test
    void createsGenerationZeroStoringOnlyTheHashOfA32ByteRefreshValue() {
        when(users.findByIdForShare(user.id())).thenReturn(Optional.of(user));
        var result = service.create(user.id(), user.passwordHash()).credential();

        assertThat(result.userId()).isEqualTo(user.id());
        assertThat(result.expiresAt()).isEqualTo(NOW.plusSeconds(1000));
        assertThat(Base64.getUrlDecoder().decode(result.refreshToken())).hasSize(32);
        var saved = savedTokens().getFirst();
        assertThat(saved.generation()).isZero();
        assertThat(saved.tokenHash()).isEqualTo(RefreshTokenHasher.hash(result.refreshToken()));
    }

    @Test
    void passwordSessionLocksTheCurrentRoleBeforeSavingAndUsesItsRestrictedLifetime() {
        user.replaceRole(UserRole.MODERATOR);
        when(users.findByIdForShare(user.id())).thenReturn(Optional.of(user));
        var created = service.create(user.id(), user.passwordHash());
        var result = created.credential();
        assertThat(created.user()).isSameAs(user);
        var ordered = org.mockito.Mockito.inOrder(users, sessions);
        ordered.verify(users).findByIdForShare(user.id());
        ordered.verify(sessions).save(any(UserSession.class));

        assertThat(result.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(10)));
        assertThat(result.mfa()).isEqualTo(new SessionService.MfaEvidence(null, null, null));
    }

    @Test
    void aDeletedUserCannotOpenAPasswordSession() {
        when(users.findByIdForShare(user.id())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.create(user.id(), user.passwordHash())).isInstanceOf(AuthenticationRequiredException.class);
        verifyNoInteractions(sessions, refreshTokens);
    }
    @Test
    void mfaVerificationRevokesTheRestrictedSessionAndStartsAVerifiedOneWithTheFullLifetime() {
        var restricted = session(NOW.plusSeconds(60));
        when(sessions.findByIdForUpdate(restricted.id())).thenReturn(Optional.of(restricted));
        UUID factorId = UUID.randomUUID();

        var verified = service.upgradeToMfa(restricted.id(), factorId);

        assertThat(restricted.revokedReason()).isEqualTo("mfa-verified");
        assertThat(verified.sessionId()).isNotEqualTo(restricted.id());
        assertThat(verified.expiresAt()).isEqualTo(NOW.plusSeconds(1000));
        assertThat(verified.mfa()).isEqualTo(new SessionService.MfaEvidence(factorId, NOW, null));
        assertThat(savedTokens().getFirst().tokenHash()).isEqualTo(RefreshTokenHasher.hash(verified.refreshToken()));
    }

    @Test
    void aRevokedOrExpiredRestrictedSessionCannotBeUpgraded() {
        var revoked = session(NOW.plusSeconds(60));
        revoked.revoke(NOW, RevocationReason.LOGOUT);
        var expired = session(NOW);
        for (var session : List.of(revoked, expired)) {
            when(sessions.findByIdForUpdate(session.id())).thenReturn(Optional.of(session));
            assertThatThrownBy(() -> service.upgradeToMfa(session.id(), UUID.randomUUID()))
                    .isInstanceOf(AuthenticationRequiredException.class);
        }
        verifyNoInteractions(refreshTokens);
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

    @Test
    void replacementRevokesThePresentingSessionAndBindsANewFixedTenMinuteSession() {
        var restricted = session(NOW.plusSeconds(60));
        when(sessions.findByIdForUpdate(restricted.id())).thenReturn(Optional.of(restricted));
        UUID factor = UUID.randomUUID();

        var replacement = service.startReplacement(restricted.id(), factor);

        assertThat(restricted.revokedReason()).isEqualTo("mfa-replacement-started");
        assertThat(replacement.sessionId()).isNotEqualTo(restricted.id());
        assertThat(replacement.expiresAt()).isEqualTo(NOW.plusSeconds(600));
        assertThat(replacement.mfa()).isEqualTo(new SessionService.MfaEvidence(null, null, factor));
        var saved = ArgumentCaptor.forClass(UserSession.class);
        verify(sessions, org.mockito.Mockito.atLeastOnce()).save(saved.capture());
        var newSession = saved.getAllValues().getLast();
        when(sessions.findById(newSession.id())).thenReturn(Optional.of(newSession));
        assertThat(service.requireActive(newSession.id(), user.id(), NOW)).isEqualTo(replacement.mfa());
        presented(newSession);
        var refreshed = service.rotate(PRESENTED);
        assertThat(refreshed.expiresAt()).isEqualTo(replacement.expiresAt());
        assertThat(refreshed.mfa()).isEqualTo(replacement.mfa());
    }

    @Test
    void revokedOrExpiredSessionsCannotStartReplacementAndVerifiedEvidenceCannotBeRebound() {
        var revoked = session(NOW.plusSeconds(60));
        revoked.revoke(NOW, RevocationReason.LOGOUT);
        for (var restricted : List.of(revoked, session(NOW))) {
            when(sessions.findByIdForUpdate(restricted.id())).thenReturn(Optional.of(restricted));
            assertThatThrownBy(() -> service.startReplacement(restricted.id(), UUID.randomUUID()))
                    .isInstanceOf(AuthenticationRequiredException.class);
        }
        var verified = session(NOW.plusSeconds(60));
        verified.markMfaVerified(UUID.randomUUID(), NOW);
        assertThatThrownBy(() -> verified.markReplacing(UUID.randomUUID())).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(refreshTokens);
    }

    @Test
    void verifiedReplacementRevokesAllSessionsAndIssuesOnlyOneNewVerifiedSession() {
        var first = session(NOW.plusSeconds(500));
        var second = session(NOW.plusSeconds(500));
        when(sessions.findActiveByUserIdForUpdate(user.id())).thenReturn(List.of(first, second));
        when(users.getReferenceById(user.id())).thenReturn(user);
        UUID factor = UUID.randomUUID();

        var verified = service.replaceAllWithVerified(user.id(), factor);

        assertThat(List.of(first, second)).allSatisfy(row -> assertThat(row.revokedReason()).isEqualTo("mfa-replaced"));
        assertThat(verified.mfa()).isEqualTo(new SessionService.MfaEvidence(factor, NOW, null));
        assertThat(verified.expiresAt()).isEqualTo(NOW.plusSeconds(1000));
        assertThat(verified.sessionId()).isNotIn(first.id(), second.id());
        assertThat(savedTokens()).hasSize(1);
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
