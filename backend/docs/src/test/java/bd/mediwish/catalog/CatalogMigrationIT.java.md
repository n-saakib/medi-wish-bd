# `CatalogMigrationIT.java`

Source: [`src/test/java/bd/mediwish/catalog/CatalogMigrationIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/CatalogMigrationIT.java)

## Purpose

Finds `013-catalog` in the parsed Liquibase master changelog at runtime, applies the preceding changesets to a guarded test schema, and inserts a synthetic existing User and session. After migration it compares full JSON snapshots of the existing User and session rows, so changed credentials, expiry, revocation or other stored values cannot pass as mere row survival. The three catalog tables start empty and a fresh login using the existing credentials still works. The seeded session has no issued access or refresh credential; the row comparison proves preservation, without claiming an authenticated request using a pre-migration token. Direct SQL probes each new Product and change-type `CHECK` constraint against a valid seed Product.

## Verification

The integration and regression test passed. Raw SQL refuses NaN selling price and MRP, while accepting `9999999.99` as the maximum finite positive control. Appended `013-catalog-finite-money` adds upper bounds; the original positive checks retain lower bounds and their specific refusal diagnostics. Existing User and session snapshots remain unchanged through the occupied-schema migration.

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).

Final cumulative verification on2026-10-07,8b6924c plus frozenWIP: normal verify passed739 units and158executed integration checks (one expected compatibility-only skip) at15:27:47; compatibility verify passed739 units and159integration checks with no skips at15:34:26. Logs: main-checkout `.scratch/ticket14-verification/final-backend-{full,compatibility}-20261007.log`. All136production class/resource payloads match the ordinary browser runtime; the compatibility profile adds optional dependency jars only.

The complete upgrade compares every existing User column except newly appended `email_verified_at`, and separately requires that column to be null. Existing identity fields and full session snapshots remain unchanged.
