package bd.mediwish.auth;

import bd.mediwish.user.UserRole;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** Current single-role authorities and MFA evidence; restricted sessions receive no role authority. */
public final class StaffAccessPolicy {
    public static final String MFA_ENROLLMENT = "MFA_ENROLLMENT";
    public static final String MFA_CHALLENGE = "MFA_CHALLENGE";
    public static final Set<String> MFA_AUTHORITIES = Set.of(MFA_ENROLLMENT, MFA_CHALLENGE);
    private StaffAccessPolicy() {}
    public record Access(MfaStatus mfa, Set<String> authorities) {}

    static Access evaluate(UserRole role, UUID activeFactorId, UUID sessionFactorId, Instant sessionVerifiedAt) {
        if (!role.isStaff()) return new Access(MfaStatus.NOT_REQUIRED, Set.of("ROLE_" + role.name()));
        if (activeFactorId == null) return new Access(MfaStatus.ENROLLMENT_REQUIRED, Set.of(MFA_ENROLLMENT));
        if (!activeFactorId.equals(sessionFactorId) || sessionVerifiedAt == null) {
            return new Access(MfaStatus.VERIFICATION_REQUIRED, Set.of(MFA_CHALLENGE));
        }
        return new Access(MfaStatus.VERIFIED, Set.of("ROLE_" + role.name()));
    }

    public static boolean isSuperAdmin(UUID userId, UserRole role, UUID bootstrapSuperAdminId) {
        return bootstrapSuperAdminId != null && bootstrapSuperAdminId.equals(userId) && role == UserRole.ADMIN;
    }
}
