package bd.mediwish.auth;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import static bd.mediwish.user.UserRole.*;
import static org.assertj.core.api.Assertions.assertThat;

class StaffAccessPolicyTest {
    private static final UUID FACTOR = UUID.randomUUID();
    private static final Instant VERIFIED_AT = Instant.parse("2026-09-27T10:00:00Z");

    @Test
    void customersAndDeliveryPeopleKeepTheirOneAuthorityWithoutMfa() {
        assertThat(StaffAccessPolicy.evaluate(CUSTOMER, null, null, null, null))
                .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.NOT_REQUIRED, Set.of("ROLE_CUSTOMER")));
        assertThat(StaffAccessPolicy.evaluate(DELIVERY_PERSON, FACTOR, FACTOR, VERIFIED_AT, null))
                .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.NOT_REQUIRED, Set.of("ROLE_DELIVERY_PERSON")));
    }

    @Test
    void staffWithoutAnActiveAuthenticatorMayOnlyEnroll() {
        for (var role : new bd.mediwish.user.UserRole[]{ADMIN, MODERATOR}) {
            assertThat(StaffAccessPolicy.evaluate(role, null, null, null, null))
                    .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.ENROLLMENT_REQUIRED, Set.of("MFA_ENROLLMENT")));
        }
    }

    @Test
    void staffWhoseSessionLacksEvidenceForTheActiveAuthenticatorMayOnlyVerify() {
        var challenge = new StaffAccessPolicy.Access(MfaStatus.VERIFICATION_REQUIRED, Set.of("MFA_CHALLENGE"));
        for (var role : new bd.mediwish.user.UserRole[]{ADMIN, MODERATOR}) {
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, null, null, null)).isEqualTo(challenge);
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, UUID.randomUUID(), VERIFIED_AT, null)).isEqualTo(challenge);
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, FACTOR, null, null)).isEqualTo(challenge);
        }
    }

    @Test
    void verifiedStaffReceiveTheirOneRoleAndSecurityExpandsItsHierarchy() {
        assertThat(StaffAccessPolicy.evaluate(ADMIN, FACTOR, FACTOR, VERIFIED_AT, null))
                .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.VERIFIED, Set.of("ROLE_ADMIN")));
        assertThat(StaffAccessPolicy.evaluate(MODERATOR, FACTOR, FACTOR, VERIFIED_AT, null).authorities()).containsExactly("ROLE_MODERATOR");
    }

    @Test
    void replacementAssuranceRequiresTheCurrentFactorAndNeverOverridesVerifiedOrNonStaffEvidence() {
        var replacement = new StaffAccessPolicy.Access(MfaStatus.REPLACEMENT_REQUIRED, Set.of("MFA_REPLACEMENT"));
        var challenge = new StaffAccessPolicy.Access(MfaStatus.VERIFICATION_REQUIRED, Set.of("MFA_CHALLENGE"));
        for (var role : new bd.mediwish.user.UserRole[]{ADMIN, MODERATOR}) {
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, null, null, FACTOR)).isEqualTo(replacement);
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, null, null, UUID.randomUUID())).isEqualTo(challenge);
            assertThat(StaffAccessPolicy.evaluate(role, null, null, null, FACTOR).mfa()).isEqualTo(MfaStatus.ENROLLMENT_REQUIRED);
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, FACTOR, VERIFIED_AT, FACTOR).mfa()).isEqualTo(MfaStatus.VERIFIED);
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, null, VERIFIED_AT, FACTOR)).isEqualTo(challenge);
        }
        for (var role : new bd.mediwish.user.UserRole[]{CUSTOMER, DELIVERY_PERSON}) {
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, FACTOR, VERIFIED_AT, FACTOR))
                    .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.NOT_REQUIRED, Set.of("ROLE_" + role.name())));
        }
        assertThat(StaffAccessPolicy.MFA_AUTHORITIES).contains("MFA_REPLACEMENT");
    }

    @Test
    void theSuperAdminIsTheBootstrapUserOnlyWhileTheyHoldAdmin() {
        UUID userId = UUID.randomUUID();
        assertThat(StaffAccessPolicy.isSuperAdmin(userId, ADMIN, userId)).isTrue();
        assertThat(StaffAccessPolicy.isSuperAdmin(userId, MODERATOR, userId)).isFalse();
        assertThat(StaffAccessPolicy.isSuperAdmin(userId, ADMIN, UUID.randomUUID())).isFalse();
        assertThat(StaffAccessPolicy.isSuperAdmin(userId, ADMIN, null)).isFalse();
    }
}
