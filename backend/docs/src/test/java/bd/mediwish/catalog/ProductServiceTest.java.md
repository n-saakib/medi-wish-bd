# `ProductServiceTest.java`

Checks service authorization and command ordering with synthetic staff principals. Moderator pricing is rejected even through direct service invocation; activation without a price is rejected. Identical retries skip the version and write, changed stale intent is rejected, edits retain a previously assigned inactive category, and assigning a newly inactive category fails.

A nanosecond-resolution fixed clock verifies catalog/pricing writes and their audit rows use microsecond timestamps, protecting identical immediate/reloaded projections.

Empty and space-only Equipment dosage regressions cover current-version refusal and stale-before-field priority, with no writes. Both cases failed before the normalization correction and passed afterward on 2026-10-07.

## Verification

All nine unit tests passed in the 739-unit guarded gate described below.

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).
