# `CategoryService.java`

Transactional category commands validate names and page bounds, enforce verified staff permission, recognize same-ID replays, reject changed-ID payloads, and compare the version after a no-op check. A changed stale edit is rejected before validating its new name. Reads attach grouped Product counts.

Name validation rejects controls before trimming, and no-op normalization preserves invalid controls so an invalid changed name cannot become an accepted identical save.

The shared page guard used by CategoryService and ProductService rejects `(long) page * size > Integer.MAX_VALUE` before database access, preserving bounded 400 INVALID_REQUEST responses rather than JPA offset overflow. Representable offsets, including the integer maximum at size 1, remain valid and can return empty pages beyond the final record.

Correction verification on 2026-10-07 at 22:06:45 Asia/Dhaka, revision `8b6924c` plus current WIP: guarded offline Maven `verify -Dit.test=CatalogRegressionIT` passed all 746 unit tests and all 5 catalog regression integration tests with zero failures/errors/skips. Disposable roles/schemas were released. Logs: main-checkout `.scratch/ticket14-verification/review-pagination-{red-units,green-units,focused-backend}-20261007.log`; red units had 4 expected overflow-refusal failures, green units passed 12/12. The full cumulative normal and compatibility gates are still pending for this corrected candidate.
