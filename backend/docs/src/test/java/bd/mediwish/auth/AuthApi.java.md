# `AuthApi.java`

Source: [`src/test/java/bd/mediwish/auth/AuthApi.java`](../../../../../../../src/test/java/bd/mediwish/auth/AuthApi.java)

## Purpose

Package-private client for the auth integration tests. `AuthApi.Shared` is a JUnit `ParameterResolver` that stores one `AuthApi` (one schema and one application) in the root extension store, so `RegistrationIT`, `SignInIT`, `SessionIT`, `ConcurrentSessionIT`, `ProfileIT`, `RoleAuthorizationIT`, `StaffMfaIT`, `StaffMfaRegressionIT` and `UserProfilePermissionIT` share one context, which JUnit closes at the end of the run. `start(testConfigurations...)` gives `SessionRestartIT`, `ConcurrentMfaIT` and `FirstAdminProvisioningIT` their own.

It creates unique synthetic Users (digit-only `017` mobiles), registers and signs them in, and checks every 200 session against the contract for its expected `mfa` value: the keys `accessToken`, `tokenType`, `expiresIn`, `user` and `mfa` (plus `backupCodes` after enrollment), a Bearer token and an HttpOnly `MW_REFRESH` cookie. A restricted staff session (`ENROLLMENT_REQUIRED` or `VERIFICATION_REQUIRED`) must report about 10 minutes for both `expiresIn` and the cookie; any other new session 900 seconds and 30 days; an overload takes an explicit remaining lifetime. It bootstraps the CSRF pair once and sends refresh and logout with the cookie, the CSRF header and the allowed Origin.

Staff helpers: `staffMe`, `startEnrollment` (checks the 201 shape, a 32-character Base32 secret and `expiresIn` 600), `verifyEnrollment`, `verifyMfa`, `enroll` (sign in, enroll and return the verified session, seed and ten backup codes), `totp(secret, stepOffset)` through `Totp`, `grantRole`/`removeRole` by SQL and `clearMfaThrottle`.

Every password, token, cookie, seed and backup code it sees is tracked; 204 and error responses, and the captured logs (`assertLogsOmitSecrets`), must omit every tracked value. Database helpers read sessions, generations and revocation reasons, verify mobiles, and install `failCommitsWhere`, a deferred constraint trigger that makes a matching commit fail. `race` releases two requests at once and returns their responses in argument order, for the racing registrations, logouts, refreshes and MFA requests.

## Verification

Exercised by every auth integration test.

Ticket 08: grantRole replaces the only stored role with UPDATE; removeRole restores CUSTOMER, preserving the existing per-request authorization fixture intent. adminUsers sends filters only in POST JSON; adminUser and putRole identify by UUID. verifiedAdmin enrolls a synthetic staff fixture; verifiedSuperAdmin uses the real provisioning transaction, once per owned schema, before enrollment. VerifiedStaff retains the fixture identity and enrollment for fresh-code/revocation checks.
## Ticket 11 helpers

profileOf, putProfile, stageMobile and cancelMobile call the owner-only profile contract. profileEdit always includes all four editable keys, retaining null values. accountState supplies the accepted closure fixture through this run's guarded schema. activatePendingMobile invokes the Spring MobileChangeService with the actual pending UUID; it creates no HTTP verification route. Staged mobile values join the privacy tracking set.

## Ticket 12 helpers

start(properties, configurations) merges explicit operator overrides into the guarded database application properties. Address/newAddress tracks synthetic delivery fields; addressBody/addressEdit serialize exact create/update contracts with nullable labels. addresses/postAddress/putAddress/deleteAddress call owner routes through the normal HTTP client. changeRows and changeTimes read committed change counts and microsecond timestamps in the owned schema. These helpers add no public test route and do not change authentication time.
userId resolves by immutable username in test SQL, so cross-story assertions can still locate the same owner after mobile activation changes the fixture mobile. HTTP routes remain owner-only and carry no username.


## Ticket 05 recovery

The raw static four-field profileEdit builder still deliberately omits currentPassword. The owner-aware overload preserves the stored email by default, queries the current email and supplies the fixture password only when that normalized address changes; the explicit password overload supports wrong/null-password contract cases.


T5 adds markEmailVerified (fixture SQL), capturedMail/awaitMail, static codeFrom, requestReset/confirmReset, requestVerification/confirmVerification and putProfileWithPassword. Public reset helpers send strict JSON with no Bearer/cookie/CSRF credentials; verification uses only the caller's Bearer. The raw profile builders remain available for invalid/missing-password contract fixtures.

accountCodes returns safe-diagnostic AccountCodeRow values and tracks every HMAC; limitRows returns typed counter snapshots. expireCode maintains the creation-before-expiry invariant while forcing expiry; ageLimits adjusts both window and last-issue timestamps without sleeping. drainMail queues a barrier behind the one-worker mail executor after completed HTTP requests, making negative mail assertions deterministic.

Six-digit values have separate whole-digit-token privacy tracking; the existing minimum-eight-character general secret tracker is unchanged. Captured code messages and submitted recovery codes/passwords join the checks. Privacy-scoped tests explicitly track the actual AuthProperties recovery key; it is not a hard-coded fixture assumption.
