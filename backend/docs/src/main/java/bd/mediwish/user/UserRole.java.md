# `UserRole.java`

Source: [`src/main/java/bd/mediwish/user/UserRole.java`](../../../../../../../src/main/java/bd/mediwish/user/UserRole.java)

Enumerates the roles assignable to the shared User resource: `CUSTOMER`, `ADMIN`, `MODERATOR` and `DELIVERY_PERSON`. Public registration assigns only `CUSTOMER`; the first `ADMIN` comes from the operator command (`FirstAdminProvisioning`). Authorization reads the persisted assignments on every request. `isStaff()` is true for `ADMIN` and `MODERATOR`, the roles that apply only to an MFA-verified session (ADR-0019, `StaffAccessPolicy`); `DELIVERY_PERSON` is not staff and signs in without MFA. Role-specific behavior belongs in the relevant feature service rather than in separate identity entities. Covered by `StaffAccessPolicyTest` and `StaffMfaIT`.
