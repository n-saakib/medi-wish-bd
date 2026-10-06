package bd.mediwish.auth;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import bd.mediwish.web.StaleUpdateException;
import org.slf4j.MDC;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Administrative role commands and bounded reads. User locks precede every session lock. */
@Service
@Transactional(readOnly = true)
public class RoleAssignmentService {
    private final UserRepository users;
    private final StaffMfaFactorRepository factors;
    private final StaffBootstrapRepository bootstrap;
    private final UserRoleChangeRepository changes;
    private final SessionService sessions;
    private final Clock clock;

    RoleAssignmentService(UserRepository users, StaffMfaFactorRepository factors, StaffBootstrapRepository bootstrap,
                          UserRoleChangeRepository changes, SessionService sessions, Clock clock) {
        this.users = users; this.factors = factors; this.bootstrap = bootstrap;
        this.changes = changes; this.sessions = sessions; this.clock = clock;
    }

    public record UserSummary(UUID id, String username, UserRole role, String staffMfa, boolean superAdmin, Instant createdAt) {}
    public record RoleChange(Instant occurredAt, String actorUsername, UserRole oldRole, UserRole newRole) {}
    public record UserRoles(UUID id, String username, UserRole role, String staffMfa, boolean superAdmin, Instant createdAt,
                            long rolesVersion, boolean self, List<UserRole> assignableRoles, List<RoleChange> roleChanges) {}
    public record UserPage(List<UserSummary> items, int page, int size, long totalItems) {}

    public UserPage search(String usernamePrefix, UserRole role, int page, int size) {
        String prefix = usernamePrefix == null ? null : usernamePrefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        if ((long) page * size > Integer.MAX_VALUE) {
            long total = users.search(prefix, role == null ? null : role.name(), PageRequest.of(0, 1)).getTotalElements();
            return new UserPage(List.of(), page, size, total);
        }
        var result = users.search(prefix, role == null ? null : role.name(), PageRequest.of(page, size));
        UUID owner = bootstrap.superAdminUserId().orElse(null);
        Set<UUID> enrolled = result.isEmpty() ? Set.of() : factors.findActiveUserIds(result.getContent().stream().map(User::id).toList());
        return new UserPage(result.getContent().stream().map(user -> summary(user, owner, enrolled.contains(user.id()))).toList(),
                page, size, result.getTotalElements());
    }

    public UserRoles detail(UUID targetId, CurrentUser actor) {
        User target = users.findById(targetId).orElseThrow(UserNotFoundException::new);
        return detail(target, actor.userId(), bootstrap.superAdminUserId().orElse(null));
    }

    @Transactional
    public UserRoles changeRole(CurrentUser actor, UUID targetId, UserRole requested, long version) {
        var locked = users.findAllByIdForUpdate(Set.copyOf(List.of(actor.userId(), targetId)));
        User caller = locked.stream().filter(user -> user.id().equals(actor.userId())).findFirst()
                .orElseThrow(AuthenticationRequiredException::new);
        User target = locked.stream().filter(user -> user.id().equals(targetId)).findFirst().orElseThrow(UserNotFoundException::new);
        SessionService.MfaEvidence evidence;
        try { evidence = sessions.requireActive(actor.sessionId(), caller.id(), clock.instant()); }
        catch (AuthenticationRequiredException ignored) { throw new AccessDeniedException("Access is denied."); }
        var access = StaffAccessPolicy.evaluate(caller.role(), factors.activeFactorIdOf(caller), evidence.factorId(), evidence.verifiedAt());
        if (caller.role() != UserRole.ADMIN || access.mfa() != MfaStatus.VERIFIED) throw new AccessDeniedException("Access is denied.");
        UUID owner = bootstrap.superAdminUserId().orElse(null);
        var outcome = RoleChangePolicy.decide(caller.role(), caller.id(), target.id(), target.role(), requested,
                target.rolesVersion(), version, owner);
        switch (outcome) {
            case ACTOR_NOT_ADMIN -> throw new AccessDeniedException("Access is denied.");
            case STALE -> throw new StaleUpdateException();
            case REFUSED_SELF, REFUSED_SUPER_ADMIN, REFUSED_ADMIN_ROLE -> throw new RoleChangeRefusedException();
            case NO_CHANGE -> { return detail(target, caller.id(), owner); }
            case APPLY -> {
                UserRole oldRole = target.role();
                target.replaceRole(requested);
                target.bumpRolesVersion();
                changes.save(new UserRoleChange(caller.id(), target.id(), oldRole, requested, clock.instant(), MDC.get("requestId")));
                sessions.revokeAllForUser(target.id(), RevocationReason.ROLE_CHANGED);
                users.flush();
                return detail(target, caller.id(), owner);
            }
        }
        throw new IllegalStateException("Unhandled role decision");
    }

    private UserRoles detail(User target, UUID actorId, UUID owner) {
        var summary = summary(target, owner, factors.findActiveId(target.id()).isPresent());
        var history = changes.findLatestForTarget(target.id(), PageRequest.of(0, 20)).stream()
                .map(change -> new RoleChange(change.getOccurredAt(), change.getActorUsername(), change.getOldRole(), change.getNewRole())).toList();
        return new UserRoles(summary.id(), summary.username(), summary.role(), summary.staffMfa(), summary.superAdmin(), summary.createdAt(),
                target.rolesVersion(), target.id().equals(actorId), RoleChangePolicy.assignableRoles(actorId, target.id(), target.role(), owner), history);
    }

    private static UserSummary summary(User user, UUID owner, boolean hasFactor) {
        return new UserSummary(user.id(), user.username(), user.role(), RoleChangePolicy.staffMfaState(user.role(), hasFactor),
                StaffAccessPolicy.isSuperAdmin(user.id(), user.role(), owner), user.createdAt());
    }
}
