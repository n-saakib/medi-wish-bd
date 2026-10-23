# `TestAuthSettings.java`

Source: [`src/test/java/bd/mediwish/testsupport/TestAuthSettings.java`](../../../../../../../src/test/java/bd/mediwish/testsupport/TestAuthSettings.java)

## Purpose

Public synthetic auth settings for unit tests that build `AuthProperties`: `MFA_SECRET_KEY` (Base64 of exactly 32 synthetic bytes), `properties()` (15-minute access, 30-day refresh, Secure cookies and the MFA defaults) and `mfa()` (issuer `Medi Wish`, 10-minute restricted session and enrollment, 5 attempts, 15-minute window and lockout). `TestDatabase.syntheticAuthProperties` passes the same key to integration applications.

## Verification

Used by the auth and web unit tests and, through `TestDatabase`, by every integration test.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.


## Ticket 05 recovery

`RECOVERY_CODE_KEY` is a process-local random 32-byte synthetic key. `recovery()` supplies the accepted Ticket 05 limits; `properties()` includes this required block.
