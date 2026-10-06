package bd.mediwish.user;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
class UserTest {
 @Test void registrationAndReplacementAlwaysExposeExactlyOneRole() {
  var user=new User("role_customer", "01700000001", null, "synthetic");
  assertThat(user.role()).isEqualTo(UserRole.CUSTOMER);
  assertThat(user.rolesVersion()).isZero();
  user.replaceRole(UserRole.MODERATOR);
  assertThat(user.roles()).containsExactly(UserRole.MODERATOR);
  user.replaceRole(UserRole.MODERATOR);
  assertThat(user.roles()).containsExactly(UserRole.MODERATOR);
  assertThat(user.rolesVersion()).isZero();
  user.bumpRolesVersion();
  assertThat(user.rolesVersion()).isOne();
  user.replaceRole(UserRole.CUSTOMER);
  assertThat(user.hasStaffRole()).isFalse();
 }
}
