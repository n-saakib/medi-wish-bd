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
        assertThat(StaffAccessPolicy.evaluate(CUSTOMER, null, null, null))
                .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.NOT_REQUIRED, Set.of("ROLE_CUSTOMER")));
        assertThat(StaffAccessPolicy.evaluate(DELIVERY_PERSON, FACTOR, FACTOR, VERIFIED_AT))
                .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.NOT_REQUIRED, Set.of("ROLE_DELIVERY_PERSON")));
    }

    @Test
    void staffWithoutAnActiveAuthenticatorMayOnlyEnroll() {
        for (var role : new bd.mediwish.user.UserRole[]{ADMIN, MODERATOR}) {
            assertThat(StaffAccessPolicy.evaluate(role, null, null, null))
                    .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.ENROLLMENT_REQUIRED, Set.of("MFA_ENROLLMENT")));
        }
    }

    @Test
    void staffWhoseSessionLacksEvidenceForTheActiveAuthenticatorMayOnlyVerify() {
        var challenge = new StaffAccessPolicy.Access(MfaStatus.VERIFICATION_REQUIRED, Set.of("MFA_CHALLENGE"));
        for (var role : new bd.mediwish.user.UserRole[]{ADMIN, MODERATOR}) {
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, null, null)).isEqualTo(challenge);
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, UUID.randomUUID(), VERIFIED_AT)).isEqualTo(challenge);
            assertThat(StaffAccessPolicy.evaluate(role, FACTOR, FACTOR, null)).isEqualTo(challenge);
        }
    }

    @Test
    void verifiedStaffReceiveTheirOneRoleAndSecurityExpandsItsHierarchy() {
        assertThat(StaffAccessPolicy.evaluate(ADMIN, FACTOR, FACTOR, VERIFIED_AT))
                .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.VERIFIED, Set.of("ROLE_ADMIN")));
        assertThat(StaffAccessPolicy.evaluate(MODERATOR, FACTOR, FACTOR, VERIFIED_AT).authorities()).containsExactly("ROLE_MODERATOR");
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
