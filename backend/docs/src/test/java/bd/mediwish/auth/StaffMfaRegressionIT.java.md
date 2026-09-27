# `StaffMfaRegressionIT.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaRegressionIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaRegressionIT.java)

## Purpose

Ways around staff MFA that must stay closed, and operator recovery paths (Ticket 06 T6), on the shared context with log checks:

- R1a/R1b: a Customer session whose User is promoted, then enrolled, refreshes into `ENROLLMENT_REQUIRED` and then `VERIFICATION_REQUIRED` with its original 30-day expiry, never staff access;
- R1e: a User who loses `ADMIN` between starting and verifying enrollment gets `403 ACCESS_DENIED` and no active factor;
- an Admin who is not the provisioned one has `superAdmin: false`; no bootstrap or setup route (`GET`/`POST` on four candidate paths) provisions an Admin;
- five wrong codes are committed (five failures, five audit rows) despite the errors; after the lock expires the right code verifies and the count resets;
- code steps must increase: after the next step is accepted, it and the current step are refused;
- an expired enrollment is `409`; an expired restricted session is `401` and cannot refresh;
- after a lost enrollment response the Admin signs in again and verifies, and backup codes are not shown again;
- Arabic-Indic digits, a non-UUID or numeric enrollment ID and a body over 16 KiB are `400 INVALID_REQUEST` and are not counted.

## Verification

9 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: the targeted integration run passed (9 tests).
