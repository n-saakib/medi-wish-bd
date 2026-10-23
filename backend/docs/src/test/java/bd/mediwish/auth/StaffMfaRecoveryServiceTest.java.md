# `StaffMfaRecoveryServiceTest.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaRecoveryServiceTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaRecoveryServiceTest.java)

## Purpose

Recovery behavior tests.

## Behavior and boundaries

Uses real MFA attempt logic, encrypted synthetic seeds and fixed time with mocked persistence/session/notifier boundaries. Tests lockout before Argon2 work, wrong/fifth failure audits, lost conditional consumption, changed factor, current role/session refusal, under-lock lockout, matching every verifier and resetting failure count. Replacement tests stale/pending expiry, wrong code, revoke/flush/delete/activate/save/session ordering and postcommit notice failure. Regeneration tests current verified evidence, step replay refusal, deletion-before-save and unchanged sessions. Factor revocation refuses non-active factors. Transaction markers ensure hash work stays outside transactions and notification runs afterward. Unit mocks do not prove PostgreSQL concurrency or migration guarantees.

## Verification

Verified 2026-10-19 on the working tree over `13968d1`: native Windows `.\mvnw.cmd -o test` passed all 1,014 backend units (zero failures, errors or skips), finishing 13:42:31 +06:00. The focused T2 gate passed 59 tests. Two controlled behavioral mutation runs detected all nine injected faults (6 failures in 29 tests, then 3 in 21); all original sources were restored before the full gate. At that run the first-enrollment owner decision was still pending. The owner has since accepted the stale-binding guard, now implemented and covered by StaffMfaServiceTest; its current verification is recorded in that test mirror and ticket evidence. These unit checks do not replace real PostgreSQL migration/concurrency verification.

A populated shared Outcome privacy assertion includes synthetic access/refresh credentials and a real synthetic UserProfile, and refuses their appearance in its string representation.

2026-10-19 review follow-up: the surrounding-ASCII-whitespace parser regression first failed (2 tests, 1 error); the populated Outcome privacy assertion first failed (1 test, 1 failure). After raw.trim() and result-only Outcome.toString(), `.\mvnw.cmd -o test -Dtest=BackupCodesTest,StaffMfaRecoveryServiceTest` passed all 18 affected tests at 13:47:52 +06:00. The earlier full 1,014-unit result predates these two narrow corrections; final broader verification remains a separate gate.

U1 coverage audit strengthens the existing cases with direct failure-count assertions for lost conditional consumption, changed factors, wrong replacement TOTP and replayed regeneration. Successful replacement/regeneration start with one failure and must reset it to zero. Regeneration permits only the active-session read and rejects every other SessionService interaction, protecting existing sessions against any revocation or rotation, not just session creation.

Coverage-audit verification (2026-10-19, working tree over `13968d1`): bypassing shared failure counting and removing the three success resets produced 8 expected failures in 16 tests; a separate unexpected regeneration revocation produced 1 expected failure in 1 test. Original source hashes were restored before the final 26-case focused gate and the full 1,016-unit gate passed (zero failures/errors/skips, 14:44:32 +06:00). These are targeted mutation proofs; passing input variants and policy/notice/session branches were not each individually mutated. The plan's risk-based ledger and separate PostgreSQL gates retain that distinction.
