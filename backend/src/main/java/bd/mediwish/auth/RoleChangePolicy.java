package bd.mediwish.auth;

import bd.mediwish.user.UserRole;
import java.util.List;
import java.util.UUID;

/** The ordered single-role assignment rules, independent of HTTP, MFA and persistence. */
public final class RoleChangePolicy {
    public enum Outcome { ACTOR_NOT_ADMIN, NO_CHANGE, REFUSED_SELF, REFUSED_SUPER_ADMIN, REFUSED_ADMIN_ROLE, STALE, APPLY }
    private RoleChangePolicy() {}

    public static Outcome decide(UserRole actorRole, UUID actorId, UUID targetId, UserRole currentRole,
                                 UserRole requestedRole, long currentVersion, long requestedVersion, UUID superAdminId) {
        if (actorRole != UserRole.ADMIN) return Outcome.ACTOR_NOT_ADMIN;
        if (requestedRole == currentRole) return Outcome.NO_CHANGE;
        if (actorId.equals(targetId)) return Outcome.REFUSED_SELF;
        if (targetId.equals(superAdminId)) return Outcome.REFUSED_SUPER_ADMIN;
        if ((requestedRole == UserRole.ADMIN || currentRole == UserRole.ADMIN) && !actorId.equals(superAdminId)) {
            return Outcome.REFUSED_ADMIN_ROLE;
        }
        if (requestedVersion != currentVersion) return Outcome.STALE;
        return Outcome.APPLY;
    }

    public static List<UserRole> assignableRoles(UUID actorId, UUID targetId, UserRole currentRole, UUID superAdminId) {
        if (actorId.equals(targetId) || targetId.equals(superAdminId)) return List.of();
        if (actorId.equals(superAdminId)) return List.of(UserRole.values());
        if (currentRole == UserRole.ADMIN) return List.of();
        return List.of(UserRole.CUSTOMER, UserRole.DELIVERY_PERSON, UserRole.MODERATOR);
    }

    public static String staffMfaState(UserRole role, boolean hasActiveFactor) {
        if (!role.isStaff()) return "NOT_REQUIRED";
        return hasActiveFactor ? "ENROLLED" : "SETUP_REQUIRED";
    }
}
