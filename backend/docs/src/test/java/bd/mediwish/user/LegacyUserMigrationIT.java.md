# `LegacyUserMigrationIT.java`

Source: [`src/test/java/bd/mediwish/user/LegacyUserMigrationIT.java`](../../../../../../../src/test/java/bd/mediwish/user/LegacyUserMigrationIT.java)

## Purpose and boundary

Proves that a populated legacy `customers` table survives the real PostgreSQL upgrade to the shared `users` and `user_roles` schema. The test uses only the existing `TestDatabase` harness, its PostgreSQL 18/test-database guard, and a schema owned by this test run; it adds no production migration seam or endpoint.

## Scenario

The test applies the master Liquibase changelog through `003-customer-java-owned-values`, confirms that migration boundary, and inserts two synthetic legacy customers with distinct identifiers, usernames and mobiles but the same non-null email, plus a third customer with a unique mixed-case email. All use the historical Ticket 02 Argon2 profile (`$argon2id$v=19$m=16384,t=2,p=1$`). Starting the application applies the remaining current master chain, including `004-shared-users-and-roles`, `005-user-password-sessions`, `006-user-email-lookup`, `007-user-email-case-insensitive-lookup` and `008-drop-unused-exact-email-index`. The test checks each row's retained identifier, username, mobile, exact email casing, verifier, mobile-verification state and creation time; asserts the duplicate and unique email counts; confirms the `CUSTOMER` role backfill; then signs in the mixed-case legacy user with a lowercase email identifier, verifies the HttpOnly refresh cookie and uses the Bearer access token to read the unchanged mixed-case profile through `/api/user/me`. The forward-only index cleanup does not rewrite stored email values or impose email uniqueness.

Only fixed synthetic values are used. The encoded verifier and password are test inputs, never printed or added to responses or logs.

## Verification

The original focused Failsafe run passed 1 test against guarded PostgreSQL 18 before changeset `006-user-email-lookup` was appended; it proved one-row preservation, role backfill and username login through the then-current `004`/`005` chain. A subsequent setup attempt was refused by the TestDatabase guard before schema DDL; that historical refusal was superseded by a later 2026-09-25 compatibility-profile run, which passed `LegacyUserMigrationIT` 1/1 through changeset 006. Neither prior run verifies the new changeset 007 or the mixed-case email fixture below. The exact earlier command and scenario are recorded in [Ticket 02 follow-up evidence](../../../../../../../../.scratch/launch-reconciliation/ticket-drafts/02%20-%20Register%20a%20Customer%20with%20simple%20authentication/evidence/2026-09-24-follow-up.md). Ticket 02's selected Chrome/Edge browser-matrix execution, other T7 checks and T8 cumulative gate also remain open.

For the case-insensitive email lookup change, the focused Failsafe command ` .\mvnw.cmd -o '-Dmaven.repo.local=D:\Web Dev\medi-wish-bd\backend\.m2\repository' '-Dit.test=AuthIT,LegacyUserMigrationIT' test-compile failsafe:integration-test failsafe:verify` passed the migration test 1/1 (15 selected integration tests total; zero failures, errors or skips). This applied changeset 007, preserved the stored mixed-case address, and signed the legacy User in using its lowercase email form before reading the unchanged profile through the Bearer-protected endpoint. Cumulative default and compatibility-profile `verify` runs then each passed all 33 PostgreSQL integration tests; default had one expected compatibility skip, compatibility had none.
