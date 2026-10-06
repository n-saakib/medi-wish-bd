# `AuthApi.java`

Source: [`src/test/java/bd/mediwish/auth/AuthApi.java`](../../../../../../../src/test/java/bd/mediwish/auth/AuthApi.java)

## Purpose

Package-private client for the auth integration tests. `AuthApi.Shared` is a JUnit `ParameterResolver` that stores one `AuthApi` (one schema and one application) in the root extension store, so `RegistrationIT`, `SignInIT`, `SessionIT`, `ConcurrentSessionIT`, `ProfileIT`, `RoleAuthorizationIT`, `StaffMfaIT` and `StaffMfaRegressionIT` share one context, which JUnit closes at the end of the run. `start(testConfigurations...)` gives `SessionRestartIT`, `ConcurrentMfaIT` and `FirstAdminProvisioningIT` their own.

It creates unique synthetic Users (digit-only `017` mobiles), registers and signs them in, and checks every 200 session against the contract for its expected `mfa` value: the keys `accessToken`, `tokenType`, `expiresIn`, `user` and `mfa` (plus `backupCodes` after enrollment), a Bearer token and an HttpOnly `MW_REFRESH` cookie. A restricted staff session (`ENROLLMENT_REQUIRED` or `VERIFICATION_REQUIRED`) must report about 10 minutes for both `expiresIn` and the cookie; any other new session 900 seconds and 30 days; an overload takes an explicit remaining lifetime. It bootstraps the CSRF pair once and sends refresh and logout with the cookie, the CSRF header and the allowed Origin.

Staff helpers: `staffMe`, `startEnrollment` (checks the 201 shape, a 32-character Base32 secret and `expiresIn` 600), `verifyEnrollment`, `verifyMfa`, `enroll` (sign in, enroll and return the verified session, seed and ten backup codes), `totp(secret, stepOffset)` through `Totp`, `grantRole`/`removeRole` by SQL and `clearMfaThrottle`.

Every password, token, cookie, seed and backup code it sees is tracked; 204 and error responses, and the captured logs (`assertLogsOmitSecrets`), must omit every tracked value. Database helpers read sessions, generations and revocation reasons, verify mobiles, and install `failCommitsWhere`, a deferred constraint trigger that makes a matching commit fail. `race` releases two requests at once and returns their responses in argument order, for the racing registrations, logouts, refreshes and MFA requests.

## Verification

Exercised by every auth integration test.

## Ticket 11 helpers

profileOf, putProfile, stageMobile and cancelMobile call the owner-only profile contract. profileEdit always includes all four editable keys, retaining null values. accountState supplies the accepted closure fixture through this run's guarded schema. activatePendingMobile invokes the Spring MobileChangeService with the actual pending UUID; it creates no HTTP verification route. Staged mobile values join the privacy tracking set.