package bd.mediwish.user;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class UserRoleTest {
    @Test void higherRolesIncludeEveryLowerRole() {
        assertThat(UserRole.ADMIN.includes(UserRole.MODERATOR)).isTrue();
        assertThat(UserRole.MODERATOR.includes(UserRole.DELIVERY_PERSON)).isTrue();
        assertThat(UserRole.DELIVERY_PERSON.includes(UserRole.CUSTOMER)).isTrue();
        assertThat(UserRole.CUSTOMER.includes(UserRole.DELIVERY_PERSON)).isFalse();
        assertThat(UserRole.MODERATOR.includes(UserRole.ADMIN)).isFalse();
        for (var role : UserRole.values()) assertThat(role.includes(role)).isTrue();
    }
    @Test void onlyAdminAndModeratorRequireMfa() {
        assertThat(UserRole.ADMIN.isStaff()).isTrue();
        assertThat(UserRole.MODERATOR.isStaff()).isTrue();
        assertThat(UserRole.DELIVERY_PERSON.isStaff()).isFalse();
        assertThat(UserRole.CUSTOMER.isStaff()).isFalse();
    }
}
