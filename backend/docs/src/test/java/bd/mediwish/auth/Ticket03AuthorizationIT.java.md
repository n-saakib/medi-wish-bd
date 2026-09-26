# `Ticket03AuthorizationIT.java`

Source: [`src/test/java/bd/mediwish/auth/Ticket03AuthorizationIT.java`](../../../../../../src/test/java/bd/mediwish/auth/Ticket03AuthorizationIT.java)

## Purpose and boundary

Verifies Ticket 03 authorization over the actual HTTP stack and PostgreSQL-backed current-user lookup without adding a production role route. `TestDatabase.create()` supplies the guarded PostgreSQL 18 database and a unique run-owned schema, which the test closes during teardown.

## Covered behavior

The test-only `Ticket03RoleAuthorizationTestConfiguration` requires `ROLE_ADMIN` on the already-existing profile path and reuses the production `BearerAccessTokenFilter`. Anonymous and invalid Bearer requests receive bounded 401 responses. A synthetic registered Customer's real access token initially receives 403; direct updates to that user's persisted role make the same token receive 200, then 403 again after role removal. A second independently registered and logged-in User provides a positive active-session control. Because each token is unchanged across role transitions, the test proves authorization uses current persisted roles rather than JWT role claims.

With both Users' active sessions, the test asks the application's `AccessTokenCodec` for correctly signed tokens pairing User A's subject with User B's session UUID and User B's subject with User A's session UUID. Both crossed subject/session combinations receive the shared bounded `401 AUTHENTICATION_REQUIRED` response with a Bearer challenge; a correctly signed token for a nonexistent session is rejected too. Each User's own active token succeeds first, so the HTTP regression distinguishes owner binding from invalid-token rejection. Response assertions stay at the HTTP boundary and do not inspect session tables.

No privileged endpoint is exposed in production. Fixture SQL is schema-qualified and limited to the generated test schema.

## Verification

On 2026-09-25, the final focused Failsafe run passed 1/1 integration case with no failures, errors or skips; the same Maven invocation passed all 115 unit tests. It used the PostgreSQL 18 `medi_wish_test` database and a temporary restricted role, then removed that role and its grants and stopped the repository-local cluster. The configured role's first preflight was correctly rejected for elevated privileges before schema creation; no behavior-driven red was observed because the existing production session binding already rejects the crossed-owner cases. This change adds regression evidence only; no production code changed.
