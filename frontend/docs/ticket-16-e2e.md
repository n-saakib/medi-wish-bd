# Ticket 16 E2E development contract

Discount implementation and local verification completed on 2026-10-13 in `ticket-16-discounts`, based on `7555e2d`. The 2026-10-11 preparation below is historical. Commit/revision mapping, merge, push and deployment are separate.

## Accepted behavior

Only an MFA-verified Admin lists, creates, edits or ends Discounts. Product and current-Category targets support whole percentages 1–99 and positive flat BDT amounts. Calendar dates use Asia/Dhaka; start and optional end dates are inclusive. Percentage **savings**, calculated from the stored selling price, round HALF_UP to two decimals. Apply one greatest eligible saving; ties prefer Product, earlier start, then UUID text order. Skip savings below 0.01 or results below 0.01. Reject Product flat amounts at or above the known selling price at save.

Targets stay fixed; a started Discount retains its start date. End now is immediate, retained and replay-safe. Identical create/update/end retries write no extra audit even with an old version or changed surrounding state. Changed stale intent conflicts. Category moves follow current membership; deactivating a previously targeted Category leaves its Discount applying. Public prices expose only an active, priced Product's six-field price projection, with no-store and request correlation; protected responses retain the bounded error envelope.

## Coverage by acceptance and sub-ticket

| Contract | Executable targets |
| --- | --- |
| AC1, T3/T4: kinds, targets, dates, current Admin/MFA permissions | `discountApi.spec.ts` E2E-16-01/02/05/06/07 plus input/auth/CORS variants; `discountUi.spec.ts` E2E-16-09/10/11/13 |
| AC2, T2/T4/T6: one greatest saving, rounding, eligibility, ties, no coupons | E2E-16-03/04, calculator/eligibility variants, strict create/update bodies, database tie fixtures and retained catalog price guards |
| AC3, T1/T5: deterministic dates, start/end, rounding and tie hierarchy | Browser helper unit boundaries; database historical fixtures and inclusive today; backend `DiscountCalendarTest`, `StaffDiscountIT` controlled-calendar transitions and tie cases |
| AC4, T6: no Product writes, fresh recomputation, immutable price evidence | E2E-16-14 and database fingerprints/audit; backend `DiscountRegressionIT`, `EffectivePriceTest` |
| AC5, T5/T8: actual browser → backend → PostgreSQL | E2E-16-10/11/12/13 CRUD/reload/permission/failure journeys; one opt-in `discountDemo.spec.ts` test implements demo steps 1–7 |
| AC6, T5/T6/T7: regression, recovery, resources, accessibility | Lost real committed responses, pending/duplicate submits, latest-only reads, pagination/payload, locale, keyboard/focus/labels/errors/44 px targets and narrow/wide layouts; backend migration/race/restart/query/log tests |

`discountDatabase.spec.ts` verifies the migrated schema, constraints/FKs, audit exactly once, table fingerprints, historical/tie fixtures and bounded derived history. All writes are confined to the existing guarded run-owned test schema. `discountSupport.test.ts` verifies the new calendar/guard/body/HTTP assertion helpers. The ordinary API and persistence journeys use real responses. Controlled empty/loading/network/malformed response cases prove frontend states only; they are not persistence acceptance.

## Final local verification

2026-10-12/13, HEAD `7555e2d0654c9ade2edff9d44465553f565b3413` plus recorded working-tree source:

- Normal guarded backend verify passed 893 units/254 IT cases (one expected compatibility skip); compatibility passed the same counts without skips/failures/errors. Five successive eight-case concurrency runs passed (40 cases).
- Final npm verification passed lint with zero warnings, types, 599 units/28 files and production build. All 82 Discount UI cases passed on Chrome/Edge. The full cumulative browser run passed 498 cases, with only the two intentionally opted-out demo skips.
- Separate opted-in Chrome demo passed one test covering all seven accepted steps, real public prices, Moderator 403 and reload persistence. All 12 generated PNGs were personally viewed without visual defects; controlled-calendar boundaries remain the separate StaffDiscountIT proof.
- Live frontend integration passed seven cases/five files and the probe reported liveness/readiness up. Final source checks covered 81 files with zero missing mirrors/index mentions or whitespace issues; tracker validation passed 64 stories/496 children.
- Cleanup recorded browser roles/schemas/sessions `0|0|0`, no task listeners on 18080/3100/55436 and owned PostgreSQL stopped. Foreign clusters remained untouched.

Actual logs, failed attempts, source applicability and cleanup live in this worktree's ignored `.scratch/ticket-16-implementation/`, including `cumulative-evidence.md`, `frontend-final-verify-8.log`, `browser-final-full-6.log`, `browser-final-demo-2.log`, `source-change-since-cumulative.json` and `final-resource-cleanup.json`. Only the opted-in demo readiness barrier changed after the cumulative pass; the other 80 source hashes remained unchanged and final frontend/demo checks cover that change. Commit/revision mapping is separate from this local proof.

Both configured Playwright projects (`chrome`, `msedge`) run the unconditional scenarios. The only optional skip is the single demo, once per browser project without `MEDI_WISH_DEMO_DIR`. No expected-failure markers turn missing features green. A per-test guard refuses date-based fixtures near 17:55–18:05 UTC; rerun after the guard window rather than interpreting this as feature success.

## Historical preparation and review

On 2026-10-11 before implementation, reviewed discovery listed 148 Discount executions and frontend verification passed 537 units. Earlier baseline suites passed 346 Chrome/Edge cases and 821 backend units; representative Discount calls failed as expected because routes, tables and navigation were absent. These are historical authoring/baseline results, not the current feature state. Compiler-only future declarations were never installed or executed.

Review strengthened response privacy, replay, page ties, history/audit, mixed-state counts, pending commands, delayed target search and focus boundaries. Production calculator/rules/service/controller/security and client/component units are now implemented. Meaningful recovery/focus regressions failed before repairs, then final suites passed. Unknown create outcomes retain original UUID/body across Cancel/Refresh until exact retry resolves. Native dialog close precedes parent focus restoration; keyboard boundaries and confirmation focus pass on both browsers.

The controlled writer test proves complete old state while blocked, then complete new state after commit; arbitrary read materialization spanning commit is not claimed. Viewport evidence covers 375/1280px layouts, short-viewport usability, labels, 44px targets and keyboard behavior; physical/on-screen keyboards are not claimed. Query counts do not establish a latency SLA or Ticket 59 load acceptance.

## Development gates

From the worktree's `frontend`, after `npm ci`:

```powershell
npm run verify
npm run test:browser -- --list --grep "@t16"
npm run test:browser -- --grep "@t16-T3|@t16-T4"
npm run test:browser -- --grep "@t16-T3|@t16-T4|@t16-T5|@t14"
npm run test:browser -- --grep "@t16"
npm run test:browser -- --grep "@smoke"
```

Browser execution needs the current built jar, PostgreSQL 18 **UTF8** `medi_wish_test` on the task-owned port 55436 and free ports 18080/3100. Earlier runs used owned 55433 before that port became another task's cluster. In the **same** PowerShell process set `TEST_DB_HOST=127.0.0.1`, `TEST_DB_PORT=55436` and `PSQL=C:\Program Files\PostgreSQL\18\bin\psql.exe`. Check the cluster/encoding and occupied ports first. The existing `testApi.ts` starts its own API with random secrets and a disposable role/schema, positively verifies migration ownership, and cleans up only its objects. Never fall back to port 5432 or copy development `.env`. Do not stop a shared cluster or another task's processes.

Backend production types and additive Product price/history projections are implemented and passed final native suites. Use ordinary `-DskipTests package` inside the guarded browser wrapper. Historical missing-feature/compiler-only runs are not current acceptance evidence.

## Cross-story and remaining obligations

Stories 08/11/14 participate through current-role/MFA sessions, Admin pricing, catalog membership, history and real fixture creation. The final cumulative run includes all prior delivered suites. The optional image journey applies only after Ticket 15 has actually merged; this branch has no image contract to exercise yet.

Snapshot, migration, controlled-calendar, restart, concurrent-write, query and log tests passed against implementation. T8 has passing integrated verification and demo/screenshot evidence; commit/revision mapping and story closure are recorded separately.

Cart 23/24 must read current prices; Order 25 must copy the accepted price/discount snapshot and add the real accepted-order immutability regression; reduction 39 must retain that snapshot. Public storefront 17, offers 18, price filtering 19, cache invalidation 20 and import/export 21/22 remain their named later boundaries. No cart, Order or provider behavior is fabricated here. D9 Preview and “loses to” hints remain excluded.

Actual counts, commands, results, source hashes and cleanup are recorded in this Ticket 16 worktree's ignored `.scratch/ticket-16-implementation/` evidence and continuation handoff. Discovery and helper passes are not proof that the Discount feature works.
