# `LegacyUserMigrationIT.java`

Source: [`src/test/java/bd/mediwish/user/LegacyUserMigrationIT.java`](../../../../../../../src/test/java/bd/mediwish/user/LegacyUserMigrationIT.java)

## Purpose and boundary

Proves that a populated legacy `customers` table survives the real PostgreSQL upgrade to the shared `users` and `user_roles` schema. The test uses only the existing `TestDatabase` harness, its PostgreSQL 18/test-database guard, and a schema owned by this test run; it adds no production migration seam or endpoint.

## Scenarios

Both tests apply the master Liquibase changelog through `003-customer-java-owned-values` and insert synthetic legacy customers that use the historical Ticket 02 Argon2 profile (`$argon2id$v=19$m=16384,t=2,p=1$`).

- **Upgrade:** three customers, one with a lowercase email, one without an email and one with a mixed-case email. Starting the application through `TestApplication.launch` applies the rest of the chain, `004-shared-users-and-roles` through `009-unique-user-email`. Each row keeps its identifier, username, mobile, exact email casing, verifier, mobile-verification state and creation time, and gets the `CUSTOMER` role. The only email index is then the unique `uk_users_email_upper` on `upper((email)::text)`. Each User signs in, by email, by username (the one without an email) and by the lowercase form of the mixed-case email, gets the HttpOnly refresh cookie, and reads its unchanged profile through `/api/user/me`.
- **Duplicate emails halt 009:** two customers whose emails differ only in case. Updating the whole changelog directly through Liquibase fails with the 009 halt message, whose stack trace names no email. The last applied changeset is `008-drop-unused-exact-email-index`, both rows are unchanged, and the non-unique `idx_users_email_upper` is still the only email index.

Only fixed synthetic values are used. The encoded verifier and password are test inputs, never printed or added to responses or logs.

## Verification

2 tests. Earlier single-scenario runs are recorded in the [Ticket 02 follow-up evidence](../../../../../../../../.scratch/launch-reconciliation/ticket-drafts/02%20-%20Register%20a%20Customer%20with%20simple%20authentication/evidence/2026-09-24-follow-up.md).

Verified 2026-09-27 on `724b0c8`: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
