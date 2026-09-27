# `StaffMfaServiceTest.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaServiceTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaServiceTest.java)

## Purpose

Unit test of `StaffMfaService` with mocked repositories, session and authentication services, the real `MfaSecretCipher` and a fixed clock:

- starting enrollment locks the User, deletes the pending factor and saves a new one whose ciphertext opens to the returned 20-byte Base32 seed, with the exact `otpauth` URI, `expiresIn` 600 and an audit event; it is refused over an active factor (`MfaEnrollmentStaleException`) and for a User without a staff role (`AccessDeniedException`);
- the right enrollment code activates the factor at the matched step, saves ten backup verifiers of dash-free codes, upgrades the session and returns ten codes; a stale or expired enrollment is refused;
- four wrong codes are `MfaCodeInvalidException` and the fifth `TooManyAttemptsException`, with five failure events and one lock event; a locked User is refused even with the right code, before any backup-code hashing;
- verification accepts a code once and a replay counts as a failure; no active factor is `AccessDeniedException`.

## Verification

8 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
