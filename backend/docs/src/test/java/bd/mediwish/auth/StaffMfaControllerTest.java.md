# `StaffMfaControllerTest.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaControllerTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaControllerTest.java)

## Purpose

Unit test of `StaffMfaController` with a mocked `StaffMfaService` and the real `RefreshCookieAdapter`: a verified code (sent as `123 456`) returns the standard session response with `mfa: VERIFIED` and a new `MW_REFRESH` cookie; enrollment verification returns the same plus the backup codes; malformed codes (null, empty, 5 or 7 digits, a letter, Arabic-Indic digits, a dash) and enrollment IDs (null, empty, not a UUID, upper case) throw `InvalidRequestException` without calling the service or setting a cookie.

## Verification

3 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
