package bd.mediwish.auth;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static bd.mediwish.user.UserRole.*;

class RoleChangePolicyTest {
 private static final UUID OWNER=UUID.randomUUID(), ADMIN_ID=UUID.randomUUID(), TARGET=UUID.randomUUID();
 @Test void actorMustBeAdminEvenForARepeatedAssignment() {
  assertThat(RoleChangePolicy.decide(MODERATOR,TARGET,TARGET,MODERATOR,MODERATOR,1,0,OWNER))
    .isEqualTo(RoleChangePolicy.Outcome.ACTOR_NOT_ADMIN);
 }
 @Test void repeatedAssignmentSucceedsBeforeVersionAndProtectedTargetChecks() {
  assertThat(RoleChangePolicy.decide(ADMIN,OWNER,OWNER,ADMIN,ADMIN,2,0,OWNER))
    .isEqualTo(RoleChangePolicy.Outcome.NO_CHANGE);
 }
 @ParameterizedTest @EnumSource(UserRole.class)
 void selfAndSuperAdminCannotChangeRole(UserRole requested) {
  var self=RoleChangePolicy.decide(ADMIN,ADMIN_ID,ADMIN_ID,ADMIN,requested,2,0,OWNER);
  assertThat(self).isEqualTo(requested==ADMIN ? RoleChangePolicy.Outcome.NO_CHANGE : RoleChangePolicy.Outcome.REFUSED_SELF);
  var ownerSelf=RoleChangePolicy.decide(ADMIN,OWNER,OWNER,ADMIN,requested,2,0,OWNER);
  assertThat(ownerSelf).isEqualTo(requested==ADMIN ? RoleChangePolicy.Outcome.NO_CHANGE : RoleChangePolicy.Outcome.REFUSED_SELF);
  var owner=RoleChangePolicy.decide(ADMIN,ADMIN_ID,OWNER,ADMIN,requested,2,0,OWNER);
  assertThat(owner).isEqualTo(requested==ADMIN ? RoleChangePolicy.Outcome.NO_CHANGE : RoleChangePolicy.Outcome.REFUSED_SUPER_ADMIN);
 }
 @Test void anOrdinaryAdminCannotSetOrRemoveAdminEvenWithAStaleVersion() {
  assertThat(RoleChangePolicy.decide(ADMIN,ADMIN_ID,TARGET,CUSTOMER,ADMIN,2,0,OWNER))
    .isEqualTo(RoleChangePolicy.Outcome.REFUSED_ADMIN_ROLE);
  assertThat(RoleChangePolicy.decide(ADMIN,ADMIN_ID,TARGET,ADMIN,CUSTOMER,2,0,OWNER))
    .isEqualTo(RoleChangePolicy.Outcome.REFUSED_ADMIN_ROLE);
  assertThat(RoleChangePolicy.decide(ADMIN,ADMIN_ID,TARGET,CUSTOMER,ADMIN,0,0,null))
    .isEqualTo(RoleChangePolicy.Outcome.REFUSED_ADMIN_ROLE);
 }
 @Test void currentVersionIsRequiredForAnActualPermittedChange() {
  assertThat(RoleChangePolicy.decide(ADMIN,ADMIN_ID,TARGET,CUSTOMER,MODERATOR,2,0,OWNER))
    .isEqualTo(RoleChangePolicy.Outcome.STALE);
  assertThat(RoleChangePolicy.decide(ADMIN,ADMIN_ID,TARGET,CUSTOMER,CUSTOMER,2,0,OWNER))
    .isEqualTo(RoleChangePolicy.Outcome.NO_CHANGE);
 }
 @Test void theOwnerCanSetAndRemoveAdminAndAllSixLowerRoleChangesAreAllowed() {
  assertThat(RoleChangePolicy.decide(ADMIN,OWNER,TARGET,CUSTOMER,ADMIN,0,0,OWNER)).isEqualTo(RoleChangePolicy.Outcome.APPLY);
  assertThat(RoleChangePolicy.decide(ADMIN,OWNER,TARGET,ADMIN,MODERATOR,0,0,OWNER)).isEqualTo(RoleChangePolicy.Outcome.APPLY);
  for(var current:new UserRole[]{CUSTOMER,DELIVERY_PERSON,MODERATOR})
   for(var requested:new UserRole[]{CUSTOMER,DELIVERY_PERSON,MODERATOR})
    if(current!=requested) assertThat(RoleChangePolicy.decide(ADMIN,ADMIN_ID,TARGET,current,requested,0,0,OWNER))
       .as("%s to %s",current,requested).isEqualTo(RoleChangePolicy.Outcome.APPLY);
 }
 @Test void assignableRolesReflectSelfOwnerAndOrdinaryAdminBoundaries() {
  assertThat(RoleChangePolicy.assignableRoles(OWNER,OWNER,ADMIN,OWNER)).isEmpty();
  assertThat(RoleChangePolicy.assignableRoles(ADMIN_ID,OWNER,ADMIN,OWNER)).isEmpty();
  assertThat(RoleChangePolicy.assignableRoles(ADMIN_ID,ADMIN_ID,ADMIN,OWNER)).isEmpty();
  assertThat(RoleChangePolicy.assignableRoles(OWNER,TARGET,ADMIN,OWNER)).containsExactly(CUSTOMER,DELIVERY_PERSON,MODERATOR,ADMIN);
  assertThat(RoleChangePolicy.assignableRoles(ADMIN_ID,TARGET,ADMIN,OWNER)).isEmpty();
  assertThat(RoleChangePolicy.assignableRoles(ADMIN_ID,TARGET,CUSTOMER,OWNER)).containsExactly(CUSTOMER,DELIVERY_PERSON,MODERATOR);
 }
 @Test void displayedMfaDependsOnTheCurrentRoleAndAnActiveFactor() {
  assertThat(RoleChangePolicy.staffMfaState(CUSTOMER,true)).isEqualTo("NOT_REQUIRED");
  assertThat(RoleChangePolicy.staffMfaState(DELIVERY_PERSON,false)).isEqualTo("NOT_REQUIRED");
  assertThat(RoleChangePolicy.staffMfaState(MODERATOR,false)).isEqualTo("SETUP_REQUIRED");
  assertThat(RoleChangePolicy.staffMfaState(ADMIN,true)).isEqualTo("ENROLLED");
 }
}
