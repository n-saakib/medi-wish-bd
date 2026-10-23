# `StaffMfaRecoveryService.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaRecoveryService.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaRecoveryService.java)

## Purpose

Core recovery service.

## Behavior and boundaries

| Operation | Behavior |
| --- | --- |
| `useBackupCode` | Prechecks lockout, compares every unused active-factor verifier outside the transaction, then rechecks role/session/factor under the User lock. A conditional consumption loss counts as a wrong code; success resets throttle and creates a replacement-only session. |
| `verifyReplacement` | Hashes ten codes outside the transaction, rechecks binding/pending enrollment, counts wrong TOTP, revokes and flushes the old factor, deletes all its codes, activates the new factor and revokes every session before issuing one verified family. Sends the notice after commit; the outcome cannot undo replacement. |
| `regenerateBackupCodes` | Requires current-factor verified evidence and an unused TOTP step, deletes only unused codes then saves ten new verifiers. Sessions remain untouched. |

Callers supply validated input. Each write uses StaffMfaAttempts for User-first locking and counted failures that commit before throwing. Argon2 work never runs inside the transaction. `ReplacedSession.toString()` is redacted because the return value carries once-only codes and credentials. The HTTP routes/adapters are wired in T4. StaffMfaRecoveryServiceTest covers stale/current evidence, races, failure commits, ordering, postcommit notice and session-preserving regeneration; real PostgreSQL tests must prove persistence and concurrency.

## Verification

Verified 2026-10-19 on the working tree over `13968d1`: native Windows `.\mvnw.cmd -o test` passed all 1,014 backend units (zero failures, errors or skips), finishing 13:42:31 +06:00. The focused T2 gate passed 59 tests. Two controlled behavioral mutation runs detected all nine injected faults (6 failures in 29 tests, then 3 in 21); all original sources were restored before the full gate. At that run the first-enrollment owner decision was still pending. The owner has since accepted the stale-binding guard, now implemented and covered by StaffMfaServiceTest; its current verification is recorded in that test mirror and ticket evidence. These unit checks do not replace real PostgreSQL migration/concurrency verification.
