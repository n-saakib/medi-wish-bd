# `ProductService.java`

Transactional Product create, edit, pricing, list, and detail behavior. A create inserts inactive/unpriced under an active category and compares a repeated UUID against normalized create fields. Edits lock the Product, recognize identical retries before checking version, enforce permissions and purchasability, and write typed history in the same transaction.

All Product mutation timestamps use PostgreSQL's microsecond precision before persistence. Immediate update responses and later reads/retries therefore return identical stored timestamps, including audit times, without adding a refresh query.

Stale changed edits use the shared bd.mediwish.web.StaleUpdateException contract; the bounded HTTP outcome remains 409 STALE_UPDATE.

Shared-contract correction verification on 2026-10-08, revision b357d50 plus Ticket 14 completion changes: guarded offline Maven `verify` passed 746 unit tests and 160 executed integration tests (one compatibility-only skip) at 09:56:32 Asia/Dhaka in 4:31. Guarded `-Pcompatibility verify` passed 746 unit tests and all 161 integration tests at 10:03:49 in 6:22, with zero failures/errors/skips. Both runs released their owned schemas and role; the final mw_run role count was zero. Existing service and HTTP seam tests preserve the same no-op/stale behavior after moving the exception to the shared web package. Logs: main-checkout `.scratch/ticket14-verification/completion-full-backend-20261008.log` and `completion-full-compatibility-20261008.log`. These are automated backend gates; final manual browser evidence remains separately required.

Ticket 16 adds effective and applied Discount projections from one batch CurrentPrices lookup per list page. Detail captures today once for pricing and derived Discount history. Stored and derived history merges newest first, with stored rows first at equal timestamps, capped at 20; derived rows are never persisted. Read-only list/detail use repeatable-read snapshots.
