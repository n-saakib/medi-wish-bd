package bd.mediwish.auth;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.user.User;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import bd.mediwish.web.StaleUpdateException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.AccessDeniedException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RoleAssignmentServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-05T00:00:00Z");
    private static final UUID FACTOR = UUID.randomUUID();
    @Mock UserRepository users;
    @Mock StaffMfaFactorRepository factors;
    @Mock StaffBootstrapRepository bootstrap;
    @Mock UserRoleChangeRepository changes;
    @Mock SessionService sessions;
    private final User admin = new User("owner.test", "01711111111", null, "synthetic-hash");
    private final User target = new User("target.test", "01722222222", null, "synthetic-hash");
    private RoleAssignmentService roles;
    private CurrentUser principal;

    @BeforeEach
    void setUp() {
        admin.replaceRole(UserRole.ADMIN);
        principal = new CurrentUser(admin.id(), UUID.randomUUID(), UserProfile.from(admin), Set.of(UserRole.ADMIN),
                MfaStatus.VERIFIED, Set.of("ROLE_ADMIN"));
        roles = new RoleAssignmentService(users, factors, bootstrap, changes, sessions, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void aPageBeyondJpaOffsetRangeIsEmptyAndKeepsTheFilteredTotal() {
        when(users.search(eq("literal\\_%"), eq("CUSTOMER"), any())).thenAnswer(call -> {
            var page = (PageRequest) call.getArgument(2);
            if (page.getOffset() > Integer.MAX_VALUE) throw new IllegalArgumentException("JPA offset out of range");
            return new PageImpl<>(List.of(target), page, 17);
        });
        var page = roles.search("literal_", UserRole.CUSTOMER, Integer.MAX_VALUE, 50);
        assertThat(page.items()).isEmpty();
        assertThat(page.page()).isEqualTo(Integer.MAX_VALUE);
        assertThat(page.size()).isEqualTo(50);
        assertThat(page.totalItems()).isEqualTo(17);
        verifyNoInteractions(factors, changes, sessions);
    }

    @Test
    void anAppliedRoleIsReplacedAndVersionedAndTheTargetSessionsAreRevoked() {
        verifiedActor();
        var result = roles.changeRole(principal, target.id(), UserRole.MODERATOR, 0);
        assertThat(result.role()).isEqualTo(UserRole.MODERATOR);
        assertThat(result.rolesVersion()).isEqualTo(1);
        assertThat(result.staffMfa()).isEqualTo("SETUP_REQUIRED");
        assertThat(result.assignableRoles()).containsExactly(UserRole.CUSTOMER, UserRole.DELIVERY_PERSON, UserRole.MODERATOR);
        assertThat(target.roles()).containsExactly(UserRole.MODERATOR);
        var ordering = inOrder(users, sessions, changes);
        ordering.verify(users).findAllByIdForUpdate(Set.of(admin.id(), target.id()));
        ordering.verify(sessions).requireActive(principal.sessionId(), admin.id(), NOW);
        ordering.verify(changes).save(any(UserRoleChange.class));
        ordering.verify(sessions).revokeAllForUser(target.id(), RevocationReason.ROLE_CHANGED);
        ordering.verify(users).flush();
    }

    @Test
    void aSameRoleRetryIgnoresTheOldVersionAndWritesNothing() {
        verifiedActor();
        var result = roles.changeRole(principal, target.id(), UserRole.CUSTOMER, 99);
        assertThat(result.role()).isEqualTo(UserRole.CUSTOMER);
        assertThat(result.rolesVersion()).isZero();
        verify(changes, never()).save(any());
        verify(sessions, never()).revokeAllForUser(any(), any());
        verify(users, never()).flush();
    }

    @Test
    void aDifferentStaleRoleWritesNothing() {
        verifiedActor();
        assertThatThrownBy(() -> roles.changeRole(principal, target.id(), UserRole.MODERATOR, 99))
                .isInstanceOf(StaleUpdateException.class);
        assertUnchanged();
    }

    @Test
    void anOrdinaryAdminCannotMakeAnotherAdminEvenWithAStaleVersion() {
        verifiedActor();
        assertThatThrownBy(() -> roles.changeRole(principal, target.id(), UserRole.ADMIN, 99))
                .isInstanceOf(RoleChangeRefusedException.class);
        assertUnchanged();
    }

    @Test
    void theActorIsRecheckedFromTheLockedUserInsteadOfTheRequestPrincipal() {
        admin.replaceRole(UserRole.CUSTOMER);
        when(users.findAllByIdForUpdate(anyCollection())).thenReturn(List.of(admin, target));
        when(sessions.requireActive(principal.sessionId(), admin.id(), NOW))
                .thenReturn(new SessionService.MfaEvidence(FACTOR, NOW));
        assertThatThrownBy(() -> roles.changeRole(principal, target.id(), UserRole.MODERATOR, 0))
                .isInstanceOf(AccessDeniedException.class);
        assertUnchanged();
    }

    @Test
    void anActorSessionRevokedWhileWaitingForTheUserLockCannotSave() {
        when(users.findAllByIdForUpdate(anyCollection())).thenReturn(List.of(admin, target));
        when(sessions.requireActive(principal.sessionId(), admin.id(), NOW)).thenThrow(AuthenticationRequiredException.class);
        assertThatThrownBy(() -> roles.changeRole(principal, target.id(), UserRole.MODERATOR, 0))
                .isInstanceOf(AccessDeniedException.class);
        assertUnchanged();
    }

    @Test
    void aSelfNoopUsesOneLockIdAndKeepsTheSession() {
        when(users.findAllByIdForUpdate(Set.of(admin.id()))).thenReturn(List.of(admin));
        when(sessions.requireActive(principal.sessionId(), admin.id(), NOW)).thenReturn(new SessionService.MfaEvidence(FACTOR, NOW));
        when(factors.activeFactorIdOf(admin)).thenReturn(FACTOR);
        var result = roles.changeRole(principal, admin.id(), UserRole.ADMIN, 99);
        assertThat(result.self()).isTrue();
        assertThat(result.assignableRoles()).isEmpty();
        assertThat(result.rolesVersion()).isZero();
        verify(sessions, never()).revokeAllForUser(any(), any());
        verify(changes, never()).save(any());
    }

    @Test
    void replacedFactorEvidenceCannotAuthorizeEvenASameRoleNoop() {
        verifiedActor();
        when(factors.activeFactorIdOf(admin)).thenReturn(UUID.randomUUID());
        assertThatThrownBy(() -> roles.changeRole(principal, target.id(), UserRole.CUSTOMER, 0))
                .isInstanceOf(AccessDeniedException.class);
        assertUnchanged();
    }
    private void verifiedActor() {
        when(users.findAllByIdForUpdate(anyCollection())).thenReturn(List.of(admin, target));
        when(sessions.requireActive(principal.sessionId(), admin.id(), NOW)).thenReturn(new SessionService.MfaEvidence(FACTOR, NOW));
        when(factors.activeFactorIdOf(admin)).thenReturn(FACTOR);
    }

    private void assertUnchanged() {
        assertThat(target.role()).isEqualTo(UserRole.CUSTOMER);
        assertThat(target.rolesVersion()).isZero();
        verify(changes, never()).save(any());
        verify(sessions, never()).revokeAllForUser(any(), any());
    }
}
