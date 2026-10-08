# `CategoryServiceTest.java`

Checks the service boundary with synthetic staff principals and a mocked persistence boundary. A matching repeated UUID returns the stored category, changed create content is an ID conflict, customer access is denied before persistence, and an identical update skips a stale version without writing. A changed stale edit takes precedence over invalid new-name length.

Leading/trailing controls are rejected in names and cannot disappear through no-op normalization; the stale-version priority remains intact for that changed intent.

Pagination regression coverage includes four offsets beyond the signed integer persistence limit and three accepted near-limit combinations, including page 2147483647 at size 1. Overflow fails before persistence; representable offsets still return an empty page. The four new refusal cases failed before the shared guard and all 12 focused units passed after it (2026-10-07, 8b6924c plus Ticket 14 WIP).

Correction verification on 2026-10-07 at 22:06:45 Asia/Dhaka, revision `8b6924c` plus current WIP: guarded offline Maven `verify -Dit.test=CatalogRegressionIT` passed all 746 unit tests and all 5 catalog regression integration tests with zero failures/errors/skips. Disposable roles/schemas were released. Logs: main-checkout `.scratch/ticket14-verification/review-pagination-{red-units,green-units,focused-backend}-20261007.log`; red units had 4 expected overflow-refusal failures, green units passed 12/12. The full cumulative normal and compatibility gates are still pending for this corrected candidate.

Stale changed edits use the shared bd.mediwish.web.StaleUpdateException contract; the bounded HTTP outcome remains 409 STALE_UPDATE.

Shared-contract correction verification on 2026-10-08, revision b357d50 plus Ticket 14 completion changes: guarded offline Maven `verify` passed 746 unit tests and 160 executed integration tests (one compatibility-only skip) at 09:56:32 Asia/Dhaka in 4:31. Guarded `-Pcompatibility verify` passed 746 unit tests and all 161 integration tests at 10:03:49 in 6:22, with zero failures/errors/skips. Both runs released their owned schemas and role; the final mw_run role count was zero. Existing service and HTTP seam tests preserve the same no-op/stale behavior after moving the exception to the shared web package. Logs: main-checkout `.scratch/ticket14-verification/completion-full-backend-20261008.log` and `completion-full-compatibility-20261008.log`. These are automated backend gates; final manual browser evidence remains separately required.
