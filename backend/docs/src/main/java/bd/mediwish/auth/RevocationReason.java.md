# `RevocationReason.java`

Source: [`src/main/java/bd/mediwish/auth/RevocationReason.java`](../../../../../../../src/main/java/bd/mediwish/auth/RevocationReason.java)

## Purpose

Package-private enum naming why a session family was revoked. Its `code` is the value stored in `user_sessions.revoked_reason`.

| Constant | Stored code | Used by |
| --- | --- | --- |
| `LOGOUT` | `logout` | `AuthenticationService.logout` for each presented refresh value. |
| `REFRESH_REPLAY` | `refresh-replay` | `SessionService.rotate` when a consumed generation is presented again. |
| `USER_UNAVAILABLE` | `user-unavailable` | `AuthenticationService.refresh` when the rotated session's User is missing or has an unusable verifier. |
| `MFA_VERIFIED` | `mfa-verified` | `SessionService.upgradeToMfa` when a restricted staff session is replaced by a verified one. |
| `STAFF_PROVISIONED` | `staff-provisioned` | `FirstAdminProvisioningService` through `SessionService.revokeAllForUser` for every session of the new Admin. |

`UserSession.revoke` records only the first reason.

## Verification

`SessionServiceTest`, `AuthenticationServiceTest`, `FirstAdminProvisioningTest`, `SessionIT`, `ConcurrentSessionIT`, `StaffMfaIT`, `ConcurrentMfaIT` and `FirstAdminProvisioningIT` assert the stored codes.

`ROLE_CHANGED` stores `role-changed`; RoleAssignmentService revokes every active target session with it in the same transaction as role replacement, version bump and audit.

Ticket 09 adds `MFA_REPLACEMENT_STARTED` (`mfa-replacement-started`) for the restricted session consumed with a backup code and `MFA_REPLACED` (`mfa-replaced`) for all sessions present at verified factor replacement. Both fit the existing VARCHAR(64) column; regeneration revokes no session.
