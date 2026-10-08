# UserRole

The exactly-one-role vocabulary is CUSTOMER (rank 0), DELIVERY_PERSON (1), MODERATOR (2), ADMIN (3). `includes(requiredRole)` compares explicit ranks so a role has all lower-role permissions. `isStaff()` preserves the separate MFA requirement for MODERATOR and ADMIN; DeliveryPerson requires no staff MFA. Spring Security expands the role hierarchy while the access policy emits only the current role's authority for an unrestricted session. `UserRoleTest` covers ordering, self inclusion, upward refusal and MFA roles.
