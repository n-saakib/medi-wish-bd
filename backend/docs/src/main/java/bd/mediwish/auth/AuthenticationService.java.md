# `AuthenticationService.java`

Source: [`src/main/java/bd/mediwish/auth/AuthenticationService.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthenticationService.java)

## Purpose

Package-private application service for password sign-in, refresh and logout. `AuthController` is its only caller; it hides User lookup, password matching, session state and token issue behind three operations.

## Operations

| Member | Behavior |
| --- | --- |
| `signIn(identifier, password)` | Normalizes the identifier with `UserIdentifierNormalizer` and collects candidates by exact username, verified mobile and case-insensitive email. Email is unique, so it adds at most one candidate, and it is looked up only when the normalized email is present, because Spring Data would turn a `null` argument into `email IS NULL`. Exactly one distinct candidate with a `PasswordVerifierPolicy`-usable verifier is matched against the password; no candidate, several candidates or an unusable verifier is matched against the dummy verifier instead, so every failure costs one Argon2 comparison. Any failure throws `AuthenticationFailedException`. Success creates a session and returns an `AuthenticatedSession`. |
| `refresh(refreshToken)` | Rotates through `SessionService.rotate`, then reloads the User. A missing User or unusable verifier revokes the rotated session with `RevocationReason.USER_UNAVAILABLE` and throws `AuthenticationRequiredException`. |
| `logout(refreshTokens)` | Revokes the session of each supplied value with `RevocationReason.LOGOUT` through `SessionService.revokeByRefreshTokens`, in one transaction. A failure rolls back every revocation; an empty list is a no-op. |

`AuthenticatedSession` carries the access token, its lifetime in seconds, the raw refresh value, the session's absolute expiry and a `UserProfile`. The raw refresh value and expiry go only to `RefreshCookieAdapter`; the controller exposes the rest.

## Boundaries

- The dummy verifier is generated once in the constructor by encoding a random UUID with the production `PasswordEncoder`; there is no configuration property for it.
- `signIn` is deliberately not transactional, so Argon2 hashing never holds a pooled connection; `SessionService.create` owns its own transaction.
- The service logs nothing and never returns which identifier field matched or why sign-in failed.

## Verification

`AuthenticationServiceTest` covers unique-candidate sign-in, wrong password, unknown and ambiguous identifiers, a blank identifier that never looks up an email, unusable verifiers, the startup dummy verifier, refresh revocation for unavailable Users and logout delegation. `SignInIT`, `SessionIT`, `ConcurrentSessionIT` and `LegacyUserMigrationIT` cover the flows over PostgreSQL.
