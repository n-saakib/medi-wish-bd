# `RevocationReason.java`

Source: [`src/main/java/bd/mediwish/auth/RevocationReason.java`](../../../../../../../src/main/java/bd/mediwish/auth/RevocationReason.java)

## Purpose

Package-private enum naming why a session family was revoked. Its `code` is the value stored in `user_sessions.revoked_reason`.

| Constant | Stored code | Used by |
| --- | --- | --- |
| `LOGOUT` | `logout` | `AuthenticationService.logout` for each presented refresh value. |
| `REFRESH_REPLAY` | `refresh-replay` | `SessionService.rotate` when a consumed generation is presented again. |
| `USER_UNAVAILABLE` | `user-unavailable` | `AuthenticationService.refresh` when the rotated session's User is missing or has an unusable verifier. |

`UserSession.revoke` records only the first reason. Later account operations that call `SessionService.revokeAllForUser` supply their own reason when they are implemented.

## Verification

`SessionServiceTest`, `AuthenticationServiceTest`, `SessionIT` and `ConcurrentSessionIT` assert the stored codes.
