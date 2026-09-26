# `SessionService.java`

Source: [`src/main/java/bd/mediwish/auth/SessionService.java`](../../../../../../../src/main/java/bd/mediwish/auth/SessionService.java)

## Purpose

Package-private transactional owner of session-family and refresh-generation state. Callers receive typed `SessionCredential(userId, sessionId, refreshToken, expiresAt)` results and never touch repository rows or digests.

## Operations

| Member | Behavior |
| --- | --- |
| `create(user)` | Creates a family expiring after the refresh lifetime and generation zero with a random 32-byte, unpadded Base64URL refresh value; only its `RefreshTokenHasher` digest is stored. |
| `rotate(presentedToken)` | Locks the presented generation and its family. A consumed generation revokes the family with `REFRESH_REPLAY` and throws `SessionReplayException`, committing the revocation. An unknown value or a revoked or expired family or generation throws `AuthenticationRequiredException`. Otherwise it consumes the generation, touches the family and issues the next generation with the family's unchanged absolute expiry. |
| `revokeByRefreshToken(token, reason)` | Revokes the family of a known value; an unknown value is ignored so logout stays idempotent. |
| `revoke(sessionId, reason)` | Locks and revokes one family if it exists. |
| `revokeAllForUser(userId, reason)` | Locks and revokes every active family of a User. It is the internal interface for later password recovery, role changes and account closure; no current route calls it. |
| `requireActive(sessionId, userId, at)` | Read-only check that the family exists, belongs to the User, is unrevoked and has not expired; otherwise throws `AuthenticationRequiredException`. |

Revocation reasons come from `RevocationReason`. Raw refresh values exist only in the returned credential and are never logged.

## Verification

`SessionServiceTest` covers creation, rotation, replay revocation, rejection of unknown, revoked and expired values, revocation by refresh value, revoke-all and active-session binding. `ConcurrentSessionIT`, `SessionRestartIT` and `SessionIT` cover locking, restart durability and revoke-all against PostgreSQL.
