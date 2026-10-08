# `CatalogTestApiTest.java`

Source: [`src/test/java/bd/mediwish/catalog/CatalogTestApiTest.java`](../../../../../../../src/test/java/bd/mediwish/catalog/CatalogTestApiTest.java)

## Purpose

Pins the integration fixture's catalog update body to editable fields plus the current version. Requested changes replace those values; id, kind, price, history and other server-owned fields stay out of the request. The literal expected map also checks nullable catalog fields are retained.

The JDBC fixture checks compare the entire copied startup map to ensure a concurrency timeout changes only `socketTimeout`; they retain the configured database, schema, role and connection timeout, verify the original map is unchanged, and pin the default three-second configuration. A separate refusal assertion prevents zero from disabling the timeout.

## Verification

All three unit tests passed, including the scoped timeout and immutable startup-map assertions.

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).
