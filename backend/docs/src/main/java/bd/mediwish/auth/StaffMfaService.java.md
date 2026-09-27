# `StaffMfaService.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaService.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaService.java)

## Purpose

Package-private service for staff authenticator enrollment and verification (Ticket 06). `StaffMfaController` is its only caller; it receives the User and the restricted session from the Bearer principal.

## Operations

| Member | Behavior |
| --- | --- |
| `startEnrollment(userId, sessionId)` | Locks the User and checks the session and staff role (below). An active factor throws `MfaEnrollmentStaleException`. Otherwise deletes any pending factor, generates a 20-byte seed, saves a `PENDING` factor with the seed sealed by `MfaSecretCipher` under the new factor ID and a pending expiry of `app.auth.mfa.enrollment-lifetime` (10 minutes), and records `MFA_ENROLLMENT_STARTED`. Returns `Enrollment(enrollmentId, secret, otpauthUri, expiresIn)`: the factor ID, the Base32 seed, `otpauth://totp/<issuer>:<username>?secret=...&issuer=<issuer>&algorithm=SHA1&digits=6&period=30` (percent-encoded, issuer `Medi Wish`) and the lifetime in seconds. The seed is returned only here. |
| `verifyEnrollment(userId, sessionId, enrollmentId, code)` | First refuses a User whose throttle is already locked (`TooManyAttemptsException`) without hashing anything. Then, outside the transaction, generates 10 `BackupCodes` and their Argon2 verifiers (over the dash-free code), because hashing is slow and must not hold a connection or the row lock. Then locks the User, checks the throttle (locked → `TooManyAttemptsException`), rejects an existing active factor or a pending factor that is missing, has another ID or has expired with `MfaEnrollmentStaleException`, and matches the code. A match activates the factor with the matched step, saves the 10 verifiers, resets the throttle, upgrades the session and records `MFA_ENROLLMENT_ACTIVATED`. Returns the verified session and the plain backup codes, once. |
| `verify(userId, sessionId, code)` | Locks the User, checks the throttle and requires an active factor (none → `AccessDeniedException`, `403`). A match records the step on the factor, resets the throttle, upgrades the session and records `MFA_VERIFIED`. |

A wrong code, including a replayed one, counts one throttle failure and records `MFA_VERIFICATION_FAILED`. The failure that reaches `max-failed-attempts` also records `MFA_ATTEMPTS_LOCKED` and is answered `429 TOO_MANY_ATTEMPTS`; earlier failures are `400 MFA_CODE_INVALID`. The transaction returns the outcome instead of throwing, so the failure count and audit rows commit before the exception is raised after the transaction.

## Boundaries

- **One writer per User:** each operation starts with `UserRepository.findByIdForUpdate`, so enrollment, verification, the throttle and the session upgrade for one User are serialized. A missing User is `401`.
- **Session and role:** `SessionService.requireActive` must accept the restricted session (revoked or expired → `401`), and the User must still hold a staff role (otherwise `AccessDeniedException`, `403 ACCESS_DENIED`).
- **Session upgrade:** `SessionService.upgradeToMfa` revokes the restricted session with `mfa-verified` and creates a new verified session with the full refresh lifetime; `AuthenticationService.issue` returns it with a new access token.
- **Codes:** `Totp.matchStep` with the factor's `lastUsedStep`, so steps must increase. The decrypted seed is zeroed after each use. Malformed codes never reach the service.
- Nothing is logged; audit rows carry no code, seed or username.

## Verification

`StaffMfaServiceTest` covers enrollment ordering and encryption, the active-factor and lost-role refusals, activation with ten backup verifiers, stale and expired enrollments, the fifth-failure lock that refuses even the right code, single-use verification and a missing factor. `StaffMfaIT`, `StaffMfaRegressionIT` and `ConcurrentMfaIT` cover the flows, the committed throttle, expiry, lost responses and concurrency against PostgreSQL.
