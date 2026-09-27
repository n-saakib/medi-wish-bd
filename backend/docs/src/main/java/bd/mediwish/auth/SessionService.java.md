# `SessionService.java`

Source: [`src/main/java/bd/mediwish/auth/SessionService.java`](../../../../../../../src/main/java/bd/mediwish/auth/SessionService.java)

## Purpose

Package-private transactional owner of session-family and refresh-generation state. Callers receive typed `SessionCredential(userId, sessionId, refreshToken, expiresAt, mfa)` results and never touch repository rows or digests. `mfa` is `MfaEvidence(factorId, verifiedAt)`: which authenticator verified the session and when, both `null` for a password-only session.

## Operations

| Member | Behavior |
| --- | --- |
| `create(user)` / `create(user, lifetime)` | Creates a family expiring after the given lifetime (the refresh lifetime by default; `AuthenticationService` passes the 10-minute restricted lifetime for staff) and generation zero with a random 32-byte, unpadded Base64URL refresh value; only its `RefreshTokenHasher` digest is stored. The new family has no MFA evidence. |
| `upgradeToMfa(restrictedSessionId, factorId)` | Runs only inside the caller's transaction (`MANDATORY`). Locks the restricted family; a missing, revoked or expired one throws `AuthenticationRequiredException`. Revokes it with `MFA_VERIFIED` and creates a new family with the full refresh lifetime, marked verified by `factorId` at now, with its own generation zero. No token issued before verification carries the new assurance. |
| `rotate(presentedToken)` | Locks the presented generation and its family. A consumed generation revokes the family with `REFRESH_REPLAY` and throws `SessionReplayException`, committing the revocation. An unknown value or a revoked or expired family or generation throws `AuthenticationRequiredException`. Otherwise it consumes the generation, touches the family and issues the next generation with the family's unchanged absolute expiry and unchanged MFA evidence. |
| `revokeByRefreshTokens(tokens, reason)` | In one transaction, locks the families of the known values in ID order and revokes each; unknown values are ignored, so logout stays idempotent, and an empty list queries nothing. It never locks a refresh-token row: `rotate` locks the token before the family, so a logout that also locked tokens could deadlock with it. |
| `revoke(sessionId, reason)` | Locks and revokes one family if it exists. |
| `revokeAllForUser(userId, reason)` | Locks and revokes every active family of a User. `FirstAdminProvisioningService` calls it with `STAFF_PROVISIONED`; later password recovery, role changes and account closure will use it too. |
| `requireActive(sessionId, userId, at)` | Read-only check that the family exists, belongs to the User, is unrevoked and has not expired, returning its `MfaEvidence`; otherwise throws `AuthenticationRequiredException`. |

Revocation reasons come from `RevocationReason`. Raw refresh values exist only in the returned credential and are never logged.

## Verification

`SessionServiceTest` covers creation, the restricted lifetime, the MFA upgrade and its refusal for revoked or expired sessions, rotation, replay revocation, rejection of unknown, revoked and expired values, revocation by refresh values (and none for an empty list), revoke-all and active-session binding. `ConcurrentSessionIT`, `SessionRestartIT`, `SessionIT`, `StaffMfaIT`, `ConcurrentMfaIT` and `FirstAdminProvisioningIT` cover locking, restart durability, the upgrade and revoke-all against PostgreSQL.
