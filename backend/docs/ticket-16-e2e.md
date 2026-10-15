# Ticket 16 backend acceptance tests

Implementation and local verification completed on 2026-10-13 in `ticket-16-discounts`, based on `7555e2d`. Test-first preparation on 2026-10-11 is historical. The frontend [coverage contract](../../frontend/docs/ticket-16-e2e.md) maps AC1–AC6, all eight sub-tickets, real browser/API tests and deferred boundaries.

| Tests | Observable contract |
| --- | --- |
| `StaffDiscountIT` | Inclusive controlled dates, unpriced/list/detail views, counts, losing/manual/calendar history, current Category movement/deactivation, role/MFA, deterministic tie hierarchy, test-calendar scan isolation; one request shares the date across list/count/detail/history and every Product page row |
| `PublicPriceIT` | Anonymous success, identical missing/inactive/unpriced/malformed errors, no-store/correlation, bounded public projection |
| `DiscountRegressionIT` | Only discount tables change, no repeated application, direct immutable snapshots without a caller transaction, selling-price history, durable restart and create/update/end retries, log privacy and current roles |
| `ConcurrentDiscountIT` | Independent HTTP sessions and PostgreSQL-observed blockers establish identical and differing create bodies, identical and differing updates, duplicate ends and update/end races; one committed mutation/audit, one stale loser, complete read tuples during an observed pending update |
| `DiscountQueriesIT` | Page candidate query is batched; distinct target/actor fixtures expose N+1 name/count/username reads; derived history stays bounded; size-50 payload remains below 64 KiB |
| `DiscountMigrationIT` | Empty installation and occupied pre-016 upgrade preserve priced/unpriced Product rows; exact decimal columns/indexes; finite/range/target/value/date/audit constraints and independent FK positive controls |
| `DiscountCalendarTest`, `EffectivePriceTest`, `DiscountTestApiTest` | Midnight/year boundaries, immutable record component contract and allow-listed retry bodies |

The initial preparation supplied nine test classes with 33 cases and three support files. Final implementation adds calculator/rules/service/controller/security units and further regression cases; the actual final counts appear below.

`DiscountTestApi` reuses the catalog harness through its additive explicit-configuration start overloads. `MovableDiscountCalendar` is a plain explicitly supplied source, never a scanned configuration; it overrides only the promotion calendar and is reacquired after application restart. Fixed test dates precede actual authentication time so manual end timestamps remain later than start events. Authentication/TOTP are not moved.

Run with Java 25 and the Maven Wrapper. Unit classes end in `Test`; real PostgreSQL integration classes end in `IT` and use the guarded `medi_wish_test` role/schema harness. Every IT command must set all `TEST_DB_*` values in one process with a throwaway role, as the accepted plan describes. Backend verification used the task-owned UTF8 cluster on 55433; final browser/demo runs used owned 55436 after 55433 became another task's cluster. Verify data-directory ownership, and never inherit development credentials or use port 5432.

```powershell
.\mvnw.cmd -o test
.\mvnw.cmd -o verify "-Dit.test=StaffDiscountIT,PublicPriceIT,DiscountMigrationIT,DiscountRegressionIT,ConcurrentDiscountIT,DiscountQueriesIT" -Dtest=none "-Dsurefire.failIfNoSpecifiedTests=false"
# Repeat ConcurrentDiscountIT five times in the same guarded role script, preserving each native exit code.
.\mvnw.cmd -o verify
.\mvnw.cmd -o -Pcompatibility verify
```

## Final local verification

2026-10-12/13, HEAD `7555e2d0654c9ade2edff9d44465553f565b3413` plus recorded working-tree source:

- Normal guarded verify passed 893 units/254 IT cases with zero failures/errors and one expected compatibility skip. Compatibility verify passed the same 893/254 with zero skips/failures/errors.
- Five successive ConcurrentDiscountIT runs passed eight cases each (40 total), recording native exits and zero remaining run-owned roles. Real migration/upgrade, controlled dates, restart, no-Product-write, role/replay and bounded log-privacy checks passed.
- Product page queries were 7/7 without/five Discounts; detail 10/10/11 without/five/many; Discount lists 10/11 for two/fifty (cap 12). Fifty-row payload was 22,985 bytes, below 64 KiB.
- Final frontend verification passed lint with zero warnings, types, 599 units/28 files and production build. Full Chrome/Edge cumulative run passed 498 with only two opted-out demo skips; separate opted-in Chrome demo passed one test. All 12 PNGs were viewed without visual defects.
- Final source evidence covers 81 files, zero missing mirrors/index mentions or whitespace failures; tracker validation passed 64 stories/496 children. Cleanup roles/schemas/sessions was `0|0|0`, task ports 18080/3100/55436 had no listeners and owned PostgreSQL was stopped.

Logs, failed attempts, manifests and cleanup evidence live in this Ticket 16 worktree's ignored `.scratch/ticket-16-implementation/`, including `cumulative-evidence.md`, `backend-final-full.log`, `backend-final-compatibility.log`, `concurrency-five-runs.log`, `frontend-final-verify-8.log`, `browser-final-full-6.log`, `browser-final-demo-2.log` and `final-resource-cleanup.json`. These are local source-manifest results; commit/revision mapping and deployment are separate.

## Historical preparation and boundaries

On 2026-10-11, before implementation, native test-compile failed with 19 missing-future-type diagnostics and the pre-change backend baseline passed 821 units. Isolated compiler-only declarations checked test syntax/harness compatibility but were never installed/executed and supplied no feature proof. The final native suites above supersede that historical red state. Prepared calendar bean naming and PostgreSQL RESTRICT SQLSTATE expectations were corrected against real execution, preserving strict rejection assertions.

The controlled writer test checks complete old state while blocked, then complete new state after commit; it does not claim arbitrary read materialization spanning commit. The snapshot proof covers Ticket 16's immutable value contract. Real accepted Order/reduction snapshots remain Tickets 25/39. No coupon, Order or provider workflow is fabricated here.
