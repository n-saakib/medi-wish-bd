# `BackupCodesTest.java`

Source: [`src/test/java/bd/mediwish/auth/BackupCodesTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/BackupCodesTest.java)

## Purpose

Backup-code input boundary tests.

## Behavior and boundaries

Tests accepted normalization including surrounding ASCII whitespace and rejection of look-alikes, malformed lengths/separators, interior ASCII control characters, non-ASCII and sharp-s case expansion. Rejection never echoes input. One thousand generated codes round-trip to their normalized verifier inputs; every batch has ten distinct codes.

## Verification

Verified 2026-10-19 on the working tree over `13968d1`: native Windows `.\mvnw.cmd -o test` passed all 1,014 backend units (zero failures, errors or skips), finishing 13:42:31 +06:00. The focused T2 gate passed 59 tests. Two controlled behavioral mutation runs detected all nine injected faults (6 failures in 29 tests, then 3 in 21); all original sources were restored before the full gate. At that run the first-enrollment owner decision was still pending. The owner has since accepted the stale-binding guard, now implemented and covered by StaffMfaServiceTest; its current verification is recorded in that test mirror and ticket evidence. These unit checks do not replace real PostgreSQL migration/concurrency verification.

2026-10-19 review follow-up: the surrounding-ASCII-whitespace parser regression first failed (2 tests, 1 error); the populated Outcome privacy assertion first failed (1 test, 1 failure). After raw.trim() and result-only Outcome.toString(), `.\mvnw.cmd -o test -Dtest=BackupCodesTest,StaffMfaRecoveryServiceTest` passed all 18 affected tests at 13:47:52 +06:00. The earlier full 1,014-unit result predates these two narrow corrections; final broader verification remains a separate gate.
