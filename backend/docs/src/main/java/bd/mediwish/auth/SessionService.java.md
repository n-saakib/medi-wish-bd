# `SessionService.java`

Source: [`src/main/java/bd/mediwish/auth/SessionService.java`](../../../../../../../src/main/java/bd/mediwish/auth/SessionService.java)

## Purpose

Package-private transactional owner of session-family and refresh-generation state. Password creation returns `PasswordSession(lockedUser, credential)` so sign-in issues from the locked role; MFA and refresh callers receive typed `SessionCredential(userId, sessionId, refreshToken, expiresAt, mfa)` results and never touch repository rows or digests. `mfa` is `MfaEvidence(factorId, verifiedAt)`: which authenticator verified the session and when, both `null` for a password-only session.

## Operations

| Member | Behavior |
| --- | --- |
| `create(userId, verifiedPasswordHash)` | Locks the current User with FOR SHARE, selects the restricted lifetime for Admin/Moderator and the full refresh lifetime otherwise, then creates the family and generation zero with a random 32-byte, unpadded Base64URL refresh value; only its `RefreshTokenHasher` digest is stored. The new family has no MFA evidence. |
| `upgradeToMfa(restrictedSessionId, factorId)` | Runs only inside the caller's transaction (`MANDATORY`). Locks the restricted family; a missing, revoked or expired one throws `AuthenticationRequiredException`. Revokes it with `MFA_VERIFIED` and creates a new family with the full refresh lifetime, marked verified by `factorId` at now, with its own generation zero. No token issued before verification carries the new assurance. |
| `rotate(presentedToken)` | Locks the presented generation, then its family using the token scalar session ID without initializing the Session first. This makes a refresh waiting behind a role-change revocation read the committed revoked state instead of reusing stale managed state. A consumed generation revokes the family with `REFRESH_REPLAY` and throws `SessionReplayException`, committing the revocation. An unknown value or a revoked or expired family or generation throws `AuthenticationRequiredException`. Otherwise it consumes the generation, touches the family and issues the next generation with the family's unchanged absolute expiry and unchanged MFA evidence. |
| `revokeByRefreshTokens(tokens, reason)` | In one transaction, locks the families of the known values in ID order and revokes each; unknown values are ignored, so logout stays idempotent, and an empty list queries nothing. It never locks a refresh-token row: `rotate` locks the token before the family, so a logout that also locked tokens could deadlock with it. |
| `revoke(sessionId, reason)` | Locks and revokes one family if it exists. |
| `revokeAllForUser(userId, reason)` | Locks and revokes every active family of a User. `FirstAdminProvisioningService` calls it with `STAFF_PROVISIONED`; role changes call it with `ROLE_CHANGED` in the same transaction as replacement, version and audit; password recovery uses `PASSWORD_RESET`; later account closure can reuse it. |
| `requireActive(sessionId, userId, at)` | Non-mutating check that the family exists, belongs to the User, is unrevoked and has not expired, returning its `MfaEvidence`; otherwise throws `AuthenticationRequiredException`. |

Revocation reasons come from `RevocationReason`. Raw refresh values exist only in the returned credential and are never logged.

## Verification

`SessionServiceTest` covers creation, the restricted lifetime, the MFA upgrade and its refusal for revoked or expired sessions, rotation, replay revocation, rejection of unknown, revoked and expired values, revocation by refresh values (and none for an empty list), revoke-all and active-session binding. `ConcurrentSessionIT`, `SessionRestartIT`, `SessionIT`, `StaffMfaIT`, `ConcurrentMfaIT` and `FirstAdminProvisioningIT` cover locking, restart durability, the upgrade and revoke-all against PostgreSQL.

Password creation and role changes lock User before sessions. Bearer authentication also takes User FOR SHARE first; requireActive joins its caller's ordinary transaction, so session evidence cannot be combined with a role committed by a concurrent promotion. Authentication releases the User lock before route handling; role commands independently recheck the actor and session under their own locks. A sign-in finishing first is included in role-change revocation; a role change finishing first makes sign-in read the new role and lifetime. Any future session creation or revoke-all writer must preserve this order. Refresh never takes the User lock.


## Ticket 05 recovery

revokeOthersForUser locks the active families in the existing ID order and skips the requesting session. Email changes use email-changed; password resets use revokeAllForUser with password-reset. Refresh generations remain as replay history and are refused through their revoked family.

## Ticket 05 integration

Password-session creation now takes the hash captured before password verification and compares it with the User read under the shared lock. A reset that changed the hash while sign-in was verifying causes the existing generic authentication failure before any session write. Other-session revocation retains the supplied current session and refresh-token history.
