# `StaffMfaServiceTest.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaServiceTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaServiceTest.java)

## Purpose

Unit test of `StaffMfaService` with mocked repositories, session and authentication services, the real `MfaSecretCipher` and a fixed clock. Construction uses the real extracted `StaffMfaAttempts`, so the existing tests continue to cover its locking, throttling and failure mapping through observable service behavior:

- starting enrollment locks the User, deletes the pending factor and saves a new one whose ciphertext opens to the returned 20-byte Base32 seed, with the exact `otpauth` URI, `expiresIn` 600 and an audit event; it is refused over an active factor (`MfaEnrollmentStaleException`) and for a User without a staff role (`AccessDeniedException`);
- the right enrollment code activates the factor at the matched step, saves ten backup verifiers of dash-free codes, upgrades the session and returns ten codes; a stale or expired enrollment is refused;
- four wrong codes are `MfaCodeInvalidException` and the fifth `TooManyAttemptsException`, with five failure events and one lock event; a locked User is refused even with the right code, before any backup-code hashing;
- verification accepts a code once and a replay counts as a failure; no active factor is `AccessDeniedException`.

## Verification

10 tests after the accepted replacement-start and stale-binding cases.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.

Ticket 08 fixtures replace CUSTOMER with ADMIN; granted role authorities contain only ROLE_ADMIN, expanded by the shared hierarchy at route authorization. Existing assurance/revocation behavior remains covered.
Verified 2026-10-19 on the working tree over `13968d1`: native Windows `cd backend; .\mvnw.cmd -o test` passed all 980 unit tests (0 failures, errors or skips), including all 8 `StaffMfaServiceTest` cases. This is the behavior-preserving extraction gate; integration verification is recorded separately.

Ticket 09 adds the accepted startEnrollment case: a mismatched replacement binding is stale while a binding to the active factor permits pending enrollment. The accepted stale-binding regression presents a valid pending factor and TOTP after the active factor is absent, while the session still carries a replacement binding. It must fail as stale after the User/session check, leaving the factor unused, throttle unchanged and no backup-code writes or session upgrade.

Verified 2026-10-19 on the working tree over `13968d1`: the accepted stale-binding regression first failed (1 test, 1 failure) before the guard, then all 10 StaffMfaServiceTest cases passed. After the U1 coverage audit, `.\mvnw.cmd -o test -Dtest=StaffMfaServiceTest,StaffMfaRecoveryServiceTest` passed 26 cases, and `.\mvnw.cmd -o test` passed all 1,016 backend units with zero failures/errors/skips at 14:44:32 +06:00. PostgreSQL verification is recorded separately.
