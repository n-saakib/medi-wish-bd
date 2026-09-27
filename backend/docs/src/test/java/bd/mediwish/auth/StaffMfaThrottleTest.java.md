# `StaffMfaThrottleTest.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaThrottleTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaThrottleTest.java)

## Purpose

Unit test of `StaffMfaThrottle` and `BackupCodes`: the fifth wrong code within the window locks verification for exactly the lockout; failures after the window, or after an expired lock, start a fresh count; a successful verification clears the count; and `BackupCodes.generate` returns ten distinct `XXXX-XXXX` codes from the unambiguous alphabet, with `normalize` removing the dash.

## Verification

5 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
