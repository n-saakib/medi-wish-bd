# `StaffAccessPolicy.java`

Source: [`src/main/java/bd/mediwish/auth/StaffAccessPolicy.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffAccessPolicy.java)

## Purpose

Public, stateless decision of what a session may do, from the User's current roles, their active authenticator and the session's MFA evidence (`user_sessions.mfa_factor_id` and `mfa_verified_at`). `CurrentUserAuthentication` applies it on every authenticated request and `AuthenticationService.issue` applies it to every session response, so a role, factor or session change takes effect on the next request.

## Decisions

`evaluate(roles, activeFactorId, sessionFactorId, sessionVerifiedAt)` returns `Access(mfa, authorities)`:

| Condition | `MfaStatus` | Authorities |
| --- | --- | --- |
| No staff role (`UserRole.isStaff`: `ADMIN` or `MODERATOR`) | `NOT_REQUIRED` | `ROLE_<NAME>` for every role |
| Staff, no active factor | `ENROLLMENT_REQUIRED` | only `MFA_ENROLLMENT` |
| Staff, session factor differs from the active one, or no verification time | `VERIFICATION_REQUIRED` | only `MFA_CHALLENGE` |
| Staff, session verified by the active factor | `VERIFIED` | `ROLE_<NAME>` for every role |

A restricted staff session therefore loses even its `CUSTOMER` authority until it is verified. The authority names are public constants, `MFA_ENROLLMENT` and `MFA_CHALLENGE`, which `SecurityConfiguration` uses for its route rules. `MFA_AUTHORITIES` (both of them) lets the access-denied handler in `SecurityConfiguration` answer `403 MFA_REQUIRED` instead of `ACCESS_DENIED`.

`isSuperAdmin(userId, roles, bootstrapSuperAdminId)` is true only for the User named by `staff_bootstrap` while they still hold `ADMIN`.

## Verification

`StaffAccessPolicyTest` covers every row, including a replaced factor and missing verification time, and the Super Admin rule. `CurrentUserAuthenticationTest`, `StaffMfaIT`, `StaffMfaRegressionIT` and `RoleAuthorizationIT` cover it through the request path.
