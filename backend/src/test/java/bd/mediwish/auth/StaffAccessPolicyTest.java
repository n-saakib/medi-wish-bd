package bd.mediwish.auth;

import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static bd.mediwish.user.UserRole.ADMIN;
import static bd.mediwish.user.UserRole.CUSTOMER;
import static bd.mediwish.user.UserRole.DELIVERY_PERSON;
import static bd.mediwish.user.UserRole.MODERATOR;
import static org.assertj.core.api.Assertions.assertThat;

class StaffAccessPolicyTest {
    private static final UUID FACTOR = UUID.randomUUID();
    private static final Instant VERIFIED_AT = Instant.parse("2026-09-27T10:00:00Z");

    @Test
    void aUserWithoutAStaffRoleKeepsTheirRolesWithoutMfa() {
        assertThat(StaffAccessPolicy.evaluate(Set.of(CUSTOMER), null, null, null))
                .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.NOT_REQUIRED, Set.of("ROLE_CUSTOMER")));
        assertThat(StaffAccessPolicy.evaluate(Set.of(CUSTOMER, DELIVERY_PERSON), null, null, null).authorities())
                .containsExactlyInAnyOrder("ROLE_CUSTOMER", "ROLE_DELIVERY_PERSON");
    }

    @Test
    void staffWithoutAnActiveAuthenticatorMayOnlyEnroll() {
        for (Set<UserRole> roles : staffRoleSets()) {
            assertThat(StaffAccessPolicy.evaluate(roles, null, null, null))
                    .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.ENROLLMENT_REQUIRED, Set.of("MFA_ENROLLMENT")));
        }
    }

    @Test
    void staffWhoseSessionLacksEvidenceForTheActiveAuthenticatorMayOnlyVerify() {
        var challenge = new StaffAccessPolicy.Access(MfaStatus.VERIFICATION_REQUIRED, Set.of("MFA_CHALLENGE"));
        for (Set<UserRole> roles : staffRoleSets()) {
            assertThat(StaffAccessPolicy.evaluate(roles, FACTOR, null, null)).isEqualTo(challenge);
            assertThat(StaffAccessPolicy.evaluate(roles, FACTOR, UUID.randomUUID(), VERIFIED_AT)).isEqualTo(challenge);
            assertThat(StaffAccessPolicy.evaluate(roles, FACTOR, FACTOR, null)).isEqualTo(challenge);
        }
    }

    @Test
    void aVerifiedStaffSessionGetsEveryRoleTheUserHolds() {
        assertThat(StaffAccessPolicy.evaluate(Set.of(CUSTOMER, ADMIN), FACTOR, FACTOR, VERIFIED_AT))
                .isEqualTo(new StaffAccessPolicy.Access(MfaStatus.VERIFIED, Set.of("ROLE_CUSTOMER", "ROLE_ADMIN")));
        assertThat(StaffAccessPolicy.evaluate(Set.of(MODERATOR), FACTOR, FACTOR, VERIFIED_AT).authorities())
                .containsExactly("ROLE_MODERATOR");
    }

    @Test
    void theSuperAdminIsTheBootstrapUserOnlyWhileTheyHoldAdmin() {
        UUID userId = UUID.randomUUID();
        assertThat(StaffAccessPolicy.isSuperAdmin(userId, Set.of(CUSTOMER, ADMIN), userId)).isTrue();
        assertThat(StaffAccessPolicy.isSuperAdmin(userId, Set.of(CUSTOMER, MODERATOR), userId)).isFalse();
        assertThat(StaffAccessPolicy.isSuperAdmin(userId, Set.of(ADMIN), UUID.randomUUID())).isFalse();
        assertThat(StaffAccessPolicy.isSuperAdmin(userId, Set.of(ADMIN), null)).isFalse();
    }

    private static Iterable<Set<UserRole>> staffRoleSets() {
        return java.util.List.of(Set.of(CUSTOMER, ADMIN), Set.of(MODERATOR), Set.of(CUSTOMER, ADMIN, MODERATOR));
    }
}
