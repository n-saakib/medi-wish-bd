# `StaffMfaIT.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaIT.java)

## Purpose

Staff sign-in over HTTP on the shared context (`AuthApi.Shared`), with captured logs checked for every tracked secret after each test:

- a Customer and a Delivery Person sign in with `mfa: NOT_REQUIRED`, read their profile and get `403 ACCESS_DENIED` on the staff and MFA routes;
- an Admin without an authenticator gets a 10-minute `ENROLLMENT_REQUIRED` session that is `403 MFA_REQUIRED` everywhere except enrollment, and the exact `otpauth` URI;
- enrollment: a wrong code is `400 MFA_CODE_INVALID`; the right one returns a `VERIFIED` session with ten backup codes, revokes the restricted session (`mfa-verified`, its token and cookie no longer work), opens `/api/staff/me` and the profile, stores a ciphertext without the seed and ten `$argon2id$` verifiers, writes the audit events in order, has only the six audit columns and marks only the new session as verified;
- an enrolled Admin gets `VERIFICATION_REQUIRED` at each sign-in, cannot enroll again, cannot reuse a code, verifies with the next code, and a refresh keeps `VERIFIED`;
- a restricted session refreshes only within its 10-minute lifetime and stays restricted; a Moderator passes MFA the same way;
- five wrong codes lock verification (four `400`, then `429 TOO_MANY_ATTEMPTS`, and `429` even for the right code) with one lock event; clearing the throttle allows verification;
- malformed codes are `400 INVALID_REQUEST` and create no throttle row; restarting enrollment makes the first enrollment `409 MFA_ENROLLMENT_STALE`;
- a revoked factor makes a verified token `403 MFA_REQUIRED`, and losing `ADMIN` makes it a plain Customer token;
- the MFA routes need no CSRF token but answer `401` without a Bearer token.

## Verification

16 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: the targeted integration run passed (16 tests).

Ticket 08 updates the staff response assertions to a singleton ADMIN or MODERATOR role array. The existing restricted-session, factor revocation and permission assertions remain cumulative regression coverage.
