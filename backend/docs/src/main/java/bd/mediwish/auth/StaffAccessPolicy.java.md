# `StaffAccessPolicy.java`

Source: [StaffAccessPolicy.java](../../../../../../../src/main/java/bd/mediwish/auth/StaffAccessPolicy.java)

Pure current-single-role and MFA decision, applied on every authenticated request and session issuance. evaluate(role, activeFactorId, sessionFactorId, verifiedAt) emits exactly one ROLE_<role> for Customers/DeliveryPeople (NOT_REQUIRED) or verified staff (VERIFIED). Spring Security's hierarchy grants lower permissions; this policy never creates extra stored roles.

ADMIN and MODERATOR without an active factor receive only MFA_ENROLLMENT; missing or stale factor evidence receives only MFA_CHALLENGE. Restricted sessions reach no role-protected route, including Customer routes. MFA_AUTHORITIES makes the denial handler return MFA_REQUIRED. isSuperAdmin requires both the singleton bootstrap identity and current ADMIN role.

Unit tests cover every decision and factor replacement; authentication and role integration tests cover current evidence at the request boundary.
