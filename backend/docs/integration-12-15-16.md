# Tickets 12, 15 and 16 integrated backend evidence

The integrated source combines saved delivery addresses, secure Product images and greatest-saving Discounts on baseline `7555e2d0654c9ade2edff9d44465553f565b3413`. Backend verification below applies to source revision `91d7e33f5336df669578cce5a2fdbcf93bf5e263` on `codex/integrate-tickets-12-15-16`; it does not establish publication to `dev`, push or deployment.

| Input | Revision |
| --- | --- |
| Ticket 12 | `d69cb880fe1773d685f41444117bca7bdec28e1a` |
| Ticket 15 | `c0f4ae96862afcb9b0031485cfde952f872db08b` |
| Ticket 16 | `750cf98d8bc8ba79a31c5afe4574672a30a45b37` |
| Images and Discounts merge | `a3b9cf6` |
| Saved addresses merge; tested source | `91d7e33` |

The merge retains both public image GET/HEAD and public price GET routes. Staff image commands retain Admin/Moderator authorization; Discount commands remain Admin-only with verified MFA. All four roles retain access to their own address book. Address commands keep the pre-authorization 16 KiB JSON limit; catalog, pricing, image JSON PUTs and Discount commands keep the post-authorization limit. Multipart uploads remain outside that JSON limiter, with 3 MiB file, 4 MiB request and 8 MiB Tomcat swallow settings. Image-order uniqueness still maps to bounded `409 STALE_UPDATE`; image, Discount and address exceptions retain externalized correlated errors. Storage and address settings coexist under single `spring`, `server` and `app` mappings. Liquibase preserves the original changeset blocks in order `015-product-images`, `016-discounts`, `017-saved-addresses`.

## Commands and completed gates

Runs use native Windows, Java 25.0.4.1 and a task-owned PostgreSQL 18.6 UTF8 cluster on `127.0.0.1:55433`, database `medi_wish_test`. The guarded wrapper checks the database/data-directory identity, creates a disposable role, isolates test schemas and removes the role in `finally`. From the repository root:

```powershell
& .\.scratch\merge-12-15-16-20261015\backend.ps1 -Suite normal
& .\.scratch\merge-12-15-16-20261015\backend.ps1 -Suite compatibility
```

Underlying commands from `backend/`, with the wrapper's guarded environment:

```powershell
.\mvnw.cmd -o verify
.\mvnw.cmd -o verify -Pcompatibility
```

| Gate | Completed, Asia/Dhaka | Unit cases | Integration cases | Result |
| --- | --- | --- | --- | --- |
| Normal verification | 2026-10-15 23:30:06 | 980 passed | 332 total: 331 passed, one expected compatibility-profile skip | BUILD SUCCESS; zero failures/errors |
| Fresh compatibility verification | 2026-10-16 06:20:40 | 980 passed | 332 passed, zero skipped | BUILD SUCCESS; zero failures/errors |

Counts come from each fresh Maven invocation's aggregate results and invocation-specific report timestamps. A directory-wide sum of retained XML files can include stale reports and is not the current run count. The fresh compatibility `ProductImageRegressionIT` report passed all four cases in 14.387 seconds.

Evidence is retained locally under [`.scratch/merge-12-15-16-20261015/`](../../.scratch/merge-12-15-16-20261015/): `candidate.json`, `backend-normal.log`, `backend-compatibility.log`, `backend-compatibility-run.json`, `surefire-normal/`, `failsafe-normal/`, `surefire-compatibility/` and `failsafe-compatibility/`. These ignored local artifacts are not Git-delivered evidence files.

## Earlier failed compatibility run

The preserved `compatibility-interrupted/` archive records 332 integration cases with zero assertion failures and two errors. `anotherNamespaceAndPlantedProductionObjectAreNeverFallbackSources` failed while starting a second application: Hikari could not obtain its initial database connection within 1,004 ms, with pool total/active/idle all zero. Its timestamp, 2026-10-15 23:41:15 Asia/Dhaka, precedes the long interruption; that error is not attributed specifically to suspension.

`crossProductCommandsAndRemovalNeverTouchAnotherProductsImages` timed out during actor setup before image operations. Its 23,100.248-second duration spans the 23,093.298-second log gap from October 15 23:41:17.858 to October 16 06:06:11.156, despite a ten-second HTTP request timeout. This is interruption-correlated evidence, not a demonstrated image regression. The uninterrupted full compatibility rerun above passed both cases; the earlier failed run remains recorded.

## Repeated concurrency evidence

On 2026-10-16, `repeat-concurrency.ps1` completed five successive guarded invocations, each with `BUILD SUCCESS` and exit 0. Every invocation passed `ConcurrentAddressBookIT` (9 cases), `ConcurrentDiscountIT` (8) and `ConcurrentProductImageIT` (6): **23 cases per run, 115 executions, zero failures, errors or skips**. The fifth finished at 06:30 Asia/Dhaka. Each invocation ran the following from `backend/` with its own disposable role:

```powershell
.\mvnw.cmd -o verify -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false "-Dit.test=ConcurrentAddressBookIT,ConcurrentProductImageIT,ConcurrentDiscountIT"
```

The five `run N exit 0` lines are in `concurrency-summary.log`; individual logs, fresh reports and invocation metadata use `concurrency-1` through `concurrency-5` labels. `backend-summary.jsonl` records invocation-specific totals. The final default-profile build supplies the browser jar; inspecting its archive confirmed no JobRunr or springdoc compatibility-only library. No Maven operation runs while that jar serves live frontend/browser checks.

Frontend/API journeys and final resource cleanup are recorded in the [frontend integration evidence](../../frontend/docs/integration-12-15-16.md). Structural ticket validation passed with zero failures (64 tickets, 496 sub-tickets, 118 requirement dispositions and 4,066 local links); `tracker-validation.log` retains the result. This merge task does not change tracker completion states.
