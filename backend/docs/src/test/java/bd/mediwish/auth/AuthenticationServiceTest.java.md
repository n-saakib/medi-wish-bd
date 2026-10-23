# `AuthenticationServiceTest.java`

Source: [`src/test/java/bd/mediwish/auth/AuthenticationServiceTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/AuthenticationServiceTest.java)

## Purpose

Unit coverage, with mocked repositories, encoder, session service, access-token codec and factor repository, `TestAuthSettings` and a fixed clock, for:

- **Sign-in:** the one User an identifier names signs in with a 30-day session and receives its profile and `NOT_REQUIRED`; a User holding `ADMIN` gets a 10-minute session with `ENROLLMENT_REQUIRED` and `expiresIn` 600, capped by the session. A wrong password fails without a session. An unknown identifier, an identifier naming two Users across fields, a blank identifier (which never calls the email lookup) and a User with an unusable stored verifier all fail generically after comparing the password against the dummy verifier, never the real one.
- **Dummy verifier:** with the production encoder, the dummy is generated at startup as a usable Argon2id verifier with the production parameters.
- **Refresh:** an access token is issued for the rotated session with its MFA status; when the User can no longer sign in (blank or unusable verifier), the rotated session is revoked with `USER_UNAVAILABLE` and authentication is required.
- **Logout:** every presented cookie is passed to `SessionService.revokeByRefreshTokens` with `LOGOUT`.

Tests use synthetic users and never print passwords, verifiers or refresh values.

## Verification

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.

Ticket 08 pins id-only password-session delegation and issues from the locked User, even when its role differs from the initial password lookup.

## Ticket 05 integration

Password-session stubs now include the exact verified hash passed to the locked creation boundary.
