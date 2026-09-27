package bd.mediwish.auth;

import bd.mediwish.user.UserRole;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Decides, on every request, what a session may do from the User's current roles, their active authenticator and
 * the session's MFA evidence. A staff session without current evidence gets only the MFA authority it needs.
 */
public final class StaffAccessPolicy {
    public static final String MFA_ENROLLMENT = "MFA_ENROLLMENT";
    public static final String MFA_CHALLENGE = "MFA_CHALLENGE";
    /** The authorities of a restricted staff session; the access-denied handler answers MFA_REQUIRED for them. */
    public static final Set<String> MFA_AUTHORITIES = Set.of(MFA_ENROLLMENT, MFA_CHALLENGE);

    private StaffAccessPolicy() {}

    public record Access(MfaStatus mfa, Set<String> authorities) {}

    static Access evaluate(Set<UserRole> roles, UUID activeFactorId, UUID sessionFactorId, Instant sessionVerifiedAt) {
        if (roles.stream().noneMatch(UserRole::isStaff)) return new Access(MfaStatus.NOT_REQUIRED, roleAuthorities(roles));
        if (activeFactorId == null) return new Access(MfaStatus.ENROLLMENT_REQUIRED, Set.of(MFA_ENROLLMENT));
        if (!activeFactorId.equals(sessionFactorId) || sessionVerifiedAt == null) {
            return new Access(MfaStatus.VERIFICATION_REQUIRED, Set.of(MFA_CHALLENGE));
        }
        return new Access(MfaStatus.VERIFIED, roleAuthorities(roles));
    }

    /** The Super Admin (S1) is the provisioned first Admin, and only while they still hold ADMIN. */
    public static boolean isSuperAdmin(UUID userId, Set<UserRole> roles, UUID bootstrapSuperAdminId) {
        return bootstrapSuperAdminId != null && bootstrapSuperAdminId.equals(userId) && roles.contains(UserRole.ADMIN);
    }

    private static Set<String> roleAuthorities(Set<UserRole> roles) {
        return roles.stream().map(role -> "ROLE_" + role.name()).collect(Collectors.toUnmodifiableSet());
    }
}
