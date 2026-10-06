# `AuthenticationService.java`

Source: [`src/main/java/bd/mediwish/auth/AuthenticationService.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthenticationService.java)

## Purpose

Package-private application service for password sign-in, refresh and logout, and the one place session responses are issued. `AuthController` calls the three operations; `StaffMfaService` calls `issue` after MFA verification.

## Operations

| Member | Behavior |
| --- | --- |
| `signIn(identifier, password)` | Normalizes the identifier with `UserIdentifierNormalizer` and collects candidates by exact username, verified mobile and case-insensitive email. Email is unique, so it adds at most one candidate, and it is looked up only when the normalized email is present, because Spring Data would turn a `null` argument into `email IS NULL`. Exactly one distinct candidate with a `PasswordVerifierPolicy`-usable verifier is matched against the password; no candidate, several candidates or an unusable verifier is matched against the dummy verifier instead, so every failure costs one Argon2 comparison. Any failure throws `AuthenticationFailedException`. Success passes only the User id to SessionService, whose shared lock reloads the current role; sign-in issues from that locked User. The session lifetime is `app.auth.mfa.restricted-session-lifetime` (10 minutes) for a User with a staff role and the refresh lifetime otherwise. |
| `refresh(refreshToken)` | Rotates through `SessionService.rotate`, then reloads the User. A missing User or unusable verifier revokes the rotated session with `RevocationReason.USER_UNAVAILABLE` and throws `AuthenticationRequiredException`. |
| `logout(refreshTokens)` | Revokes the session of each supplied value with `RevocationReason.LOGOUT` through `SessionService.revokeByRefreshTokens`, in one transaction. A failure rolls back every revocation; an empty list is a no-op. |
| `issue(user, session)` | Issues an access token for the session and evaluates `StaffAccessPolicy` with the User's one role, their active factor (`StaffMfaFactorRepository.activeFactorIdOf`) and the session's MFA evidence. `expiresIn` is the access-token lifetime or the time left in the session, whichever is shorter, so a restricted session's token is reported as usable only while the session lives. |

`AuthenticatedSession` carries the access token, `expiresIn`, the raw refresh value, the session's absolute expiry, a `UserProfile` and the `MfaStatus`. The raw refresh value and expiry go only to `RefreshCookieAdapter`; the controllers expose the rest.

## Boundaries

- The dummy verifier is generated once in the constructor by encoding a random UUID with the production `PasswordEncoder`; there is no configuration property for it.
- `signIn` is deliberately not transactional, so Argon2 hashing never holds a pooled connection; `SessionService.create` owns its own transaction.
- Refresh never raises assurance: a rotated password session keeps no MFA evidence, so a User promoted to staff after sign-in gets only an MFA authority, with the session's original expiry.
- The service logs nothing and never returns which identifier field matched or why sign-in failed.

## Verification

`AuthenticationServiceTest` covers unique-candidate sign-in, the restricted staff sign-in and its capped `expiresIn`, wrong password, unknown and ambiguous identifiers, a blank identifier that never looks up an email, unusable verifiers, the startup dummy verifier, refresh revocation for unavailable Users and logout delegation. `SignInIT`, `SessionIT`, `ConcurrentSessionIT`, `LegacyUserMigrationIT`, `StaffMfaIT` and `StaffMfaRegressionIT` cover the flows over PostgreSQL.
