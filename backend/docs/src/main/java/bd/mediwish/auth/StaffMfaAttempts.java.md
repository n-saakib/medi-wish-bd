# `StaffMfaAttempts.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaAttempts.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaAttempts.java)

## Purpose

Package-private component extracted from `StaffMfaService` for shared staff MFA attempt rules. Callers retain transaction ownership and provide the attempt time, keeping their User, session, throttle and factor operations in the same transaction.

## Operations

| Member | Behavior |
| --- | --- |
| `lockActiveStaff(userId, sessionId, now)` | Locks the User first, requires an active session belonging to that User and requires a current staff role. Returns `Locked(user, evidence)` with the session evidence. Missing User/session or expired/revoked session is `401`; a lost staff role is `403`. |
| `throttle(userId, now)` | Returns the existing throttle or saves its initial state. The caller already holds the User lock. |
| `matchStep(factor, code, now)` | Decrypts the seed, matches an unused TOTP step and zeroes the decrypted bytes in `finally`. |
| `failure(throttle, userId, sessionId, now, failedType)` | Counts the failure and records the caller-selected audit type. Reaching the limit also records `MFA_ATTEMPTS_LOCKED` and returns `LOCKED`; otherwise returns `INVALID`. |
| `sessionOrThrow(outcome)` | After the caller's transaction commits, returns the successful session or throws `MfaCodeInvalidException`/`TooManyAttemptsException`. |

## Boundaries

This extraction adds no transaction boundary or enrollment policy. `Result` and `Outcome` carry success/failure decisions out of the transaction so counted failures commit before the HTTP error. No code, seed or personal data is logged or audited. The component needs no clock because callers pass their captured `Instant`.

## Verification

The existing eight `StaffMfaServiceTest` cases use the real component and cover User locking, role refusal, successful enrollment/challenge, stale enrollment, failure counting, lockout and TOTP replay. Existing MFA integration checks protect transaction behavior.

Verified 2026-10-19 on the working tree over `13968d1`: native Windows `cd backend; .\mvnw.cmd -o test` passed all 980 unit tests (0 failures, errors or skips), including all 8 `StaffMfaServiceTest` cases. This is the behavior-preserving extraction gate; integration verification is recorded separately.

T2 follow-up verification: the 2026-10-19 full backend unit gate passed 1,014 tests over `13968d1`; controlled removal of current-role enforcement was detected before the original guard was restored.

`Outcome.toString()` includes only its result. Its session may contain credentials and contact data, so the shared outcome never expands that record into diagnostic text.

2026-10-19 review follow-up: the surrounding-ASCII-whitespace parser regression first failed (2 tests, 1 error); the populated Outcome privacy assertion first failed (1 test, 1 failure). After raw.trim() and result-only Outcome.toString(), `.\mvnw.cmd -o test -Dtest=BackupCodesTest,StaffMfaRecoveryServiceTest` passed all 18 affected tests at 13:47:52 +06:00. The earlier full 1,014-unit result predates these two narrow corrections; final broader verification remains a separate gate.
