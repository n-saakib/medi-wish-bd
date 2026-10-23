# `CurrentUserAuthenticationTest.java`

Source: [`src/test/java/bd/mediwish/auth/CurrentUserAuthenticationTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/CurrentUserAuthenticationTest.java)

## Purpose

Unit coverage for loading the current User from an access token, with mocked codec, session service, User and factor repositories. An active session resolves the persisted profile, current roles, `NOT_REQUIRED` and `ROLE_CUSTOMER`, not role claims from the token. A staff User gets only `MFA_CHALLENGE` while the session has no evidence, and `VERIFIED` with its one role authority once the session carries evidence for the active factor. An invalid token is rejected before the session is read, and a revoked or expired session without granting current role authorities or querying the factor. A User whose stored verifier is blank or unusable is unauthenticated (`401`) without reading session evidence. `mobile_verified=false` does not affect usability.

## Verification

Deterministic promotion versus bearer authentication is covered through real HTTP and PostgreSQL by [`ConcurrentRoleChangeIT`](ConcurrentRoleChangeIT.java.md). Role and MFA denial over HTTP is covered by [`RoleAuthorizationIT`](RoleAuthorizationIT.java.md) and [`StaffMfaIT`](StaffMfaIT.java.md).

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.

Ticket 08 fixtures replace CUSTOMER with ADMIN; granted role authorities contain only ROLE_ADMIN, expanded by the shared hierarchy at route authorization. Existing assurance/revocation behavior remains covered.

Ticket 09 adapts synthetic session evidence to `MfaEvidence(factorId, verifiedAt, replacingFactorId)` with a null replacement binding in these existing scenarios; their original behavior assertions remain unchanged.
