# `ProductServiceTest.java`

Checks service authorization and command ordering with synthetic staff principals. Moderator pricing is rejected even through direct service invocation; activation without a price is rejected. Identical retries skip the version and write, changed stale intent is rejected, edits retain a previously assigned inactive category, and assigning a newly inactive category fails.

A nanosecond-resolution fixed clock verifies catalog/pricing writes and their audit rows use microsecond timestamps, protecting identical immediate/reloaded projections.

Empty and space-only Equipment dosage regressions cover current-version refusal and stale-before-field priority, with no writes. Both cases failed before the normalization correction and passed afterward on 2026-10-07.

## Verification

All nine unit tests passed in the 739-unit guarded gate described below.

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).

Stale changed edits use the shared bd.mediwish.web.StaleUpdateException contract; the bounded HTTP outcome remains 409 STALE_UPDATE.

Shared-contract correction verification on 2026-10-08, revision b357d50 plus Ticket 14 completion changes: guarded offline Maven `verify` passed 746 unit tests and 160 executed integration tests (one compatibility-only skip) at 09:56:32 Asia/Dhaka in 4:31. Guarded `-Pcompatibility verify` passed 746 unit tests and all 161 integration tests at 10:03:49 in 6:22, with zero failures/errors/skips. Both runs released their owned schemas and role; the final mw_run role count was zero. Existing service and HTTP seam tests preserve the same no-op/stale behavior after moving the exception to the shared web package. Logs: main-checkout `.scratch/ticket14-verification/completion-full-backend-20261008.log` and `completion-full-compatibility-20261008.log`. These are automated backend gates; final manual browser evidence remains separately required.

Ticket 16 injects current-pricing, derived-history and Dhaka-calendar collaborators alongside existing create/edit replay and persisted-timestamp tests.

Price/history seam coverage verifies one batch per list page, unpriced null projections, detail winning Discount mapping, newest-first history with stored-first timestamp ties and the 20-row cap, without saving derived rows.
