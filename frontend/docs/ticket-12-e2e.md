# Ticket 12 end-to-end acceptance coverage

Written on 2026-10-11 for branch `ticket-12-delivery-addresses`, baseline revision `7555e2d0654c9ade2edff9d44465553f565b3413`. Reviewed the complete accepted implementation plan, parent AC1–AC7, every child 12.T1–12.T8, shared TESTING/WORKFLOW, specification, decision amendments, ADR-0009, account lifecycle, delivered-feature handoffs and address page design. Three bounded sub-agents wrote API, browser and database tests; their combined result was reviewed before verification.

These tests specify the accepted contract before Ticket 12’s production routes, UI and migration exist. They intentionally run and fail when feature behavior is absent. Only the optional screenshot demo skips without its explicitly requested artifact directory. A discovered test is not passing acceptance evidence; no story or sub-ticket is closed by this change.

The subsequent five-round critical review and its corrections, current discovery counts and verification limits are recorded in [ticket-12-e2e-review.md](ticket-12-e2e-review.md). A fresh five-round follow-up is recorded separately in [ticket-12-e2e-review-fresh.md](ticket-12-e2e-review-fresh.md). The third five-cycle review is recorded in [ticket-12-e2e-review-third.md](ticket-12-e2e-review-third.md). The current coverage additions and verification are recorded in [ticket-12-e2e-current.md](ticket-12-e2e-current.md). The original execution record below remains historical evidence for the pre-review tests.

## Coverage

| Criterion / decision | Automated checks |
| --- | --- |
| AC1 / A2 own CRUD, exactly one default, cap | Browser add/edit/delete/reload, API strict success projection, default/version matrix, six-way fourth-address race and PostgreSQL default uniqueness/composite ownership keys |
| AC2 / A1 default deletion | Oldest remaining `(created_at, id)` selection, promotion versions, status naming successor, stale promotion conflict, delete last and non-default |
| AC3 / A4 checkout boundary | No incoming foreign key to `saved_addresses`; API save obeys capacity/change/closure constraints. Actual manual checkout and post-order save are Ticket 25 work |
| AC4 / A9 closure and immutable destination boundary | Own GET stays readable, every mutation refuses closure including open stale dialogs; all-table write fingerprints and profile/mobile staging independence; actual Order snapshots assigned to Ticket 25 |
| AC5 real browser / API | Customer journeys and direct authenticated HTTP requests over the existing jar/PostgreSQL harness; response-loss hooks forward to real API before discarding responses |
| AC6 security/regression/nonfunctional | Four roles, restricted MFA, absent/revoked credentials, ownership/field authorization, canonical IDs/versions, strict JSON/byte limits, log/URL/console/storage privacy, keyboard/focus/error labels, 375/1280 layouts, smoke and optional demo |
| AC7 / A7–A8 limits and notice | Fifth-change concurrency, sixth refusal with zero writes, per-user isolation, exact advisory allowance, create/edit/default counting; delete/promotion/replay/identical/refused zero counts; notice on every Add/Edit, zero leaves Save enabled, reload updates allowance |
| A3 safe validation / A6 Unicode | Null/blank/max/over-max, trim-before-length and collapsed spaces, controls/line separators, ASCII mobile formats, Bengali round trips and literal rendering of HTML/script-looking text; UTF8 real browser test cluster |
| A10 accepted retry limitation | Same create ID after its row was deleted creates again and counts twice |
| Recovery | Stale reload, removed-record 404, lost responses for add/edit/delete, stable create ID and changed-payload conflict, Cancel/Escape after uncertain save, single-flight and late old-session replies |
| Cross-story | `@cross-11-12` profile/mobile/closure independence; `@cross-08-12` staff own-book/ownership with Ticket 06 MFA |

Plan IDs E2E-12-01–22 are retained. Additional API cases use 23–49 and 90–92, UI cases use 50–78 and 93–94, and database cases use 80–83. Parameterized variants include their operation in the full title. Each acceptance test has exactly one task tag identifying its earliest delivery gate; security/regression labels do not add a second task gate. Demo uses `@t12-demo` as prescribed by T8.

## Run

Use the supported native Windows Node 24/JDK 25, installed stable Chrome and Edge and PostgreSQL 18 UTF8. Install `npm ci` in `frontend`; package the backend with `.\mvnw.cmd -o -q package -DskipTests` first. Set `TEST_DB_HOST=127.0.0.1`, `TEST_DB_PORT=55433` and the test-cluster administrator settings from `testApi.ts`. The harness creates and cleans a unique role/schema on `medi_wish_test`; never use development data. Browser runs serialize across worktrees on 18080/3100.

- `npm run verify`: lint, strict types, cumulative units, production build.
- `npm run test:browser -- --grep @t12 --list`: inspect acceptance discovery without starting servers.
- `npm run test:browser -- --grep @t12-T2`: installed database contract.
- `npm run test:browser -- --grep @t12-T5`: browser/API integration acceptance.
- `npm run test:browser -- --grep @t12-T6`: recovery/security/regression.
- `npm run test:browser -- --grep @t12-T7`: smoke/accessibility/layout.
- `npm run test:browser -- --grep @t12`: entire acceptance suite (demo skips unless configured).
- Set an absolute `MEDI_WISH_DEMO_DIR`, then `npm run test:browser -- --grep @t12-demo`: screenshots and private-value-free reviewer step log.

AC7 real-clock browser checks throw a clear setup error within five minutes of Dhaka Monday/month-start midnight. They do not silently skip and do not invent a test-only HTTP clock endpoint.

## Remaining evidence when implementing the story

Fixed-calendar backend `AddressChangeLimitIT` must prove the monthly tenth/eleventh change, exact half-open Dhaka week/month/year transitions, weeks spanning months, microsecond timestamps, pruning/GET non-pruning, configuration override and calendar isolation from auth and address timestamps. Browser weekly checks cannot replace those.

Backend deterministic service-lock gates, default/delete/closure races, forced commit rollback and process restart remain mandatory. Installed-schema SQL probes do not prove empty/preceding-schema migration upgrade; `AddressMigrationIT` owns that evidence. Backend units, frontend production units/projector tests, query statement counts, compatibility verify and actual recorded demo remain implementation gates. Repeat live integration/probe and cumulative delivered-feature browser/API suites after feature implementation; their current passing baseline is recorded below. No fabricated latency target is introduced; Ticket 59 owns load acceptance.

Ticket 25 must prove manual checkout independent of saving, default preselection, immutable Order copies and post-order save in a separate transaction (refusal cannot roll back an accepted Order). Ticket 13 owns Admin full-profile views; Tickets 46/47 own the complete closure permission set and terminal-row cleanup. Hosting must use UTF8.

## Verification results

All results are 2026-10-11 on the stated baseline plus uncommitted test/doc additions, using native Windows Node 24.18.0, Java 25.0.4.1 and PostgreSQL 18 UTF8 on 55433.

| Command / check | Actual result |
| --- | --- |
| Baseline `.\mvnw.cmd -o -q package -DskipTests` | Passed; packaged this worktree’s unchanged backend for the browser harness. No backend test result is implied by `-DskipTests` |
| Baseline `npm run verify` with `VITEST_MAX_WORKERS=1` | Passed lint, typecheck, 503 units across 25 files and production build before test installation |
| New-file TypeScript, targeted ESLint and `npx vitest run --project unit tests/addressSupport.test.ts` | Passed; 28 helper units. An initial typecheck found two test typing issues (timeout details and header-array inference), both corrected before passing checks |
| Cumulative `npm run lint`, `npm run typecheck`, `npm run test:unit` with `VITEST_MAX_WORKERS=1` | Passed; 531 units across 26 files, including all 28 new fixture units |
| Source/doc parity, index entries, whitespace and skip review | Passed for all six new source/test files; no acceptance skip; optional demo skip is required by T8 |
| Real Chrome/Edge delivered-feature suite `npm run test:browser -- --grep-invert "@t12"` | Passed 346/346 (173 per browser), no failures/skips, exit 0, 14.8 minutes. First unquoted PowerShell invocation stopped before running tests; quoted invocation is the actual suite |
| Final `npx playwright test --grep "@t12" --list --reporter=json` | Passed: 176 checks across Chrome/Edge (87 acceptance + one optional demo per channel); unique titles and exactly one task tag per acceptance verified |
| Real Ticket 12 API/database/smoke execution | 84 failed (42 per channel: 37 API, four database, one UI smoke), two optional demos skipped because `MEDI_WISH_DEMO_DIR` was unset; exit 1, no setup errors. Missing routes return 401/403, migration tables are absent, and Account has no Addresses link. These are feature failures, not passing acceptance or environment blocks |
| Live `npm run test:integration` and `npm run probe` against a separate real isolated API/schema | Passed seven integration tests across five files; probe reported liveness/readiness up, exit 0 |
| Final database diagnostic ESLint and E2E-12-80 rerun | ESLint passed. Both real-browser cases failed with the explicit missing-017-tables assertion (exit 1, no setup errors), replacing the initial empty-metadata JSON parse failure. Production build passed as part of the harness |
| Cleanup | Zero harness roles, schemas or other client connections remained; 18080/3100 had no listeners. Stopped only the UTF8 PostgreSQL cluster on 55433 that this task started |

Runtime JSON and live logs are kept in the main checkout's ignored `.scratch/ticket12-e2e-20261011/`; `run-new-tests.ps1` and `live-checks.mjs` reproduce the run with the existing `testApi.ts` lifecycle. Discovery is recorded in `.scratch/ticket12-e2e-discovery.json`. Reviewable resolution and the coverage audit are in the parent ticket's ignored `evidence/` directory. These local evidence files are intentionally not force-added.

Full new UI and configured screenshot demo cannot yet establish feature success because the page/API/migration are absent. Backend story units/ITs, compatibility, migration upgrade, monthly/time boundaries, restart and query measurements are unrun in this test-writing change, as detailed above. Story and child acceptance statuses remain open.
