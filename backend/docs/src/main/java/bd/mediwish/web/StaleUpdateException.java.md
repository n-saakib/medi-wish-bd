# `StaleUpdateException.java`

Source: [`src/main/java/bd/mediwish/web/StaleUpdateException.java`](../../../../../../../src/main/java/bd/mediwish/web/StaleUpdateException.java)

Shared web exception for a supplied version that no longer describes the current record. ApiExceptionHandler maps it to bounded 409 STALE_UPDATE using the externalized error message. Feature services recognize identical retries before this check and do not bump the version.

Shared-contract correction verification on 2026-10-08, revision b357d50 plus Ticket 14 completion changes: guarded offline Maven `verify` passed 746 unit tests and 160 executed integration tests (one compatibility-only skip) at 09:56:32 Asia/Dhaka in 4:31. Guarded `-Pcompatibility verify` passed 746 unit tests and all 161 integration tests at 10:03:49 in 6:22, with zero failures/errors/skips. Both runs released their owned schemas and role; the final mw_run role count was zero. Existing service and HTTP seam tests preserve the same no-op/stale behavior after moving the exception to the shared web package. Logs: main-checkout `.scratch/ticket14-verification/completion-full-backend-20261008.log` and `completion-full-compatibility-20261008.log`. These are automated backend gates; final manual browser evidence remains separately required.
