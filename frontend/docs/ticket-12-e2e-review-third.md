# Ticket 12 E2E critical review: third five-cycle pass

Date: 2026-10-11. Branch: `ticket-12-delivery-addresses`. Base revision: `7555e2d0654c9ade2edff9d44465553f565b3413` plus pre-existing uncommitted test and documentation files. This report covers a new five-cycle review requested by the user; the [earlier review](ticket-12-e2e-review.md) and [follow-up](ticket-12-e2e-review-fresh.md) remain historical evidence.

Each cycle uses separate UI and contract reviewers, followed by separate validators who check findings against the accepted plan and make bounded corrections. The root reviews the integrated diff and verification evidence. Production Ticket 12 implementation and ticket closure are outside this review.

## Findings and dispositions

| Cycle | Confirmed finding | Addressed |
| --- | --- | --- |
| 1 | No browser create selected Default in an already populated book; a POST mapper could ignore the checkbox. | E77 submits the selected default through the browser and checks independent command fields, demotion/version, unchanged neighbor, counted changes, chips and reload. |
| 1 | Edit prefill omitted address/city/default and cancellation checked only City. | E03 checks all prefilled fields, normalizes four text fields and preserves the other row; E51 checks all dirty values, Keep, Cancel and Escape restoration without commands. |
| 1 | Card labels were interpolated into a regular expression without escaping. | Escape regex punctuation and exercise a literal punctuation label in E77. |
| 1 | Backend-response assertions accepted controls, blank non-null labels and unnormalized free text. | Require safe normalized text using Java trim semantics, retaining NBSP/FEFF positive cases; add focused helper rejection units. |
| 1 | Concurrent identical edits could rewrite timestamps without detection. | E37 compares complete address/change rows before and after concurrent no-op retries. |
| 1 | Ordinary overlong PUT values and padded maximum labels/PUT were absent. | E24 covers those boundaries, with complete no-write comparisons and five counted changes. |
| 2 | Lost PUT recovery asserted status/count without independently proving edited fields, identities, versions or unchanged neighbors. | Strengthen E60's independent command and exact durable-state assertions through lost reply, retry and default removal. |
| 2 | Unknown-create Cancel/Escape cases filled the last slot, so no subsequent Add proved a fresh dialog ID. | Add vacancy-preserving close/reopen journeys that require fresh IDs and two intended durable addresses. |
| 2 | E59's stored expectation copied the observed outgoing request. | Compare commands and rows to independently entered values, capturing only the generated ID. |
| 2 | Named unique indexes could masquerade as primary keys; a narrower default-index predicate could pass Dhaka-only fixtures. | Verify actual PK constraints/ordered columns and exercise duplicate defaults across other cities. |
| 2 | Positive address commands did not prove Bearer-only, cookie-independent access; POST ID type fixtures were incomplete. | Add an isolated cookie-free Bearer CRUD journey and strict ID-type negatives. |
| 3 | Malformed GET coverage omitted null structures and several required/optional field types, allowing coercion or unbounded null failures. | Extend the strict-projection matrix across structural, text, account-state and numeric type branches. |
| 3 | Modal accessibility checks never required a dialog name; forbidden browser text sampled only recipient name. | Require Add/Edit names tied to their visible headings; add control/separator fixtures in other fields to the zero-command validation matrix. |
| 3 | ASCII and Bengali BMP fixtures did not distinguish accepted UTF16 length from codepoint counting or rejected supplementary letters. | Add exact-max supplementary text on POST/changed PUT and exact max+1 refusals on both routes. |
| 3 | No-write tests contained no history eligible for pruning. | Seed expired synthetic changes to observe no pruning on reads/replays/identical edits/deletes and rollback on exhaustion, followed by pruning on a true write. |
| 4 | Bearer-only E46 forbade response cookies, an unsupported constraint on compliant behavior. | Use a fresh cookie-free context for each request while allowing response cookies; retain Bearer freshness, exact outcomes and cleanup. |
| 4 | Only GET 500 covered initial load errors, and failure checks omitted Add-action isolation. | Cover network/MFA/non-JSON load failures, focused bounded feedback, unavailable mutation actions and real Reload recovery; hide Add after malformed projections too. |
| 4 | Ordinary closure reads could steal focus, while only refused-command focus was checked. | Add the complementary unfocused closure-warning assertion to E08. |
| 4 | Ancient/current history cannot distinguish strict earlier-window cutoff from inclusive or later-window pruning. | Seed a change exactly at the earlier Dhaka week/month start and verify true writes retain it with independently counted allowances. |
| 5 | Schema tests proved address capacity stayed outside SQL, but did not similarly probe configurable change limits. | Insert eleven current-period history rows inside a rolled-back probe, then verify no history persists. Service configuration behavior remains a separate backend IT. |
| 5 | No further material UI/demo defect was confirmed after challenging accumulated corrections. | Independently validate the no-change conclusion and rerun scoped checks; standalone Chrome/Edge probes verify new control/separator fixtures survive native input/textarea fill. Clarify E51’s misleading title: Keep retains the draft; Cancel/Escape discard it. |

## Integrated result

- **Delivered:** Five sequential cycles, each with two reviewers followed by two separate validators: 20 agent assignments. Confirmed findings above are addressed in the three feature specs, shared response oracle and focused helper units. Final UI validation found no additional material defect. E51’s title now agrees with its retention assertions.
- **Boundaries:** The tests specify the accepted plan using real browser/API/SQL journeys plus explicit intercepted client failures. Controlled fixture probes validate test assertions without claiming production migration acceptance. No production implementation, new public API, commit, push, merge or deployment is included.
- **Verified:** On 2026-10-11 over revision `7555e2d0654c9ade2edff9d44465553f565b3413`, native Windows `VITEST_MAX_WORKERS=1 npm run verify` passed lint, project-wide TypeScript, 592/592 units in 26 files and production build. Final discovery passed with 332 checks, zero setup errors, unique titles per project and valid task/demo tags. Existing API integration passed 7/7 tests; health reported liveness/readiness up. Live feature execution failed as detailed below.
- **Documentation:** Updated all five changed source/test mirrors, the frontend index and coverage guide. The findings table and local evidence manifest make the corrections reviewable. Earlier reports and demo source/mirror are unchanged against the task’s starting SHA-256 snapshot.
- **Notes:** Ticket 12’s address page, API and migration remain absent. Six representative real feature checks fail; the complete Ticket 12 suite/demo and cumulative browser acceptance remain unrun. Monthly exhaustion, fixed-calendar rollover/both cutoff orderings, deterministic locking, injected rollback, restart and migration-upgrade checks remain accepted backend implementation gates. Checkout and immutable Orders remain Ticket 25 scope. No ticket is marked complete.

## Verification evidence

Commands ran from the frontend worktree on native Windows Node 24, using installed Chrome/Edge and PostgreSQL 18 where applicable. The branch is `ticket-12-delivery-addresses`; all corrections remain uncommitted. Evidence resides under the ignored `.scratch/ticket12-e2e-review-third/` directory and is reviewable locally, not committed documentation evidence.

| Check | Actual result | Local evidence |
| --- | --- | --- |
| Starting `VITEST_MAX_WORKERS=1 npm run verify` | Exit 0: lint, TypeScript, 551/551 units, production build. | `verify-baseline.log` |
| Final `VITEST_MAX_WORKERS=1 npm run verify` | Exit 0: lint, TypeScript, 592/592 units in 26 files, production build. Includes 89 helper units versus the starting 48. | `verify-final.log` |
| `node.exe node_modules/@playwright/test/cli.js test --list --grep "@t12" --reporter=json` | Exit 0: 332 checks (166/channel), no discovery errors, duplicate titles or missing task/demo tags. UI 240, API 82, database 8, demo 2. Discovery is not execution. | `discovery-final.json` |
| Per-cycle native TypeScript, scoped ESLint and selected discovery | Validators passed each cycle’s scoped checks; final project-wide verification covers the integrated sources. Cycle 5 UI: 240 checks; database: eight checks. | Agent resolutions; `r5-ui-discovery.json` |
| Backend `.\mvnw.cmd -o -q package -DskipTests` | Exit 0. Builds the real harness backend; backend tests were not run by this command. | `backend-package.log` |
| `node.exe node_modules/@playwright/test/cli.js test --grep 'E2E-12-(15 |80 |26 )' --reporter=json` | Exit 1: six failures, zero skips, zero setup errors across both channels. Smoke times out at the absent Addresses link; mobile API reaches the absent table; metadata check explicitly reports missing migration 017. Run after cycle 1 using the isolated UTF8 cluster on 55433. | `live-representative.json` |
| `npm run test:integration` and `npm run probe` through the existing real `testApi.ts` lifecycle | Exit 0: 7/7 existing API tests in five files; liveness/readiness up, separate isolated schema. This does not establish browser regression or Ticket 12 acceptance. | `integration-probe.log` |
| Rollback-only PostgreSQL metadata/default fixture probes | Exit 0: actual primary keys accepted; named unique-index-only and reversed-key mutants rejected; city-restricted default mutant exposed. All fixture DDL rolled back. | `schema-query-check.log`, `schema-query-check.mjs` |
| Final rollback-only PostgreSQL probe, including the actual E82 eleven-row SQL template | Exit 0: eleven current-period rows accepted; a deliberately hardcoded ten-row trigger rejected. Repeats PK/default positive and mutant checks. All fixture DDL rolled back; production migration remains absent. | `schema-query-final-check.log`, `schema-query-final-check.mjs` |
| Standalone installed Chrome/Edge native-input probe | Exit 0: all 12 combinations of U+0085/U+2028/U+2029, text input/textarea and browser preserve the invalid characters. Fixture validation only. | `ui-input-sanitizer-probe.cjs`, `.log` |
| Native `git.exe diff --check` and explicit whitespace/hash inspection of task files | Exit 0; no trailing whitespace in task files. Demo and older reports retain starting hashes; all changed source/test files have matching mirrors and index entries. | Starting/final manifests and `diffs/` |

E49 independently computes Dhaka week/month starts and always detects inclusive cutoff pruning. It distinguishes earlier/later cutoffs only when the current starts differ; fixed-calendar backend tests must exercise both orderings and equal starts. The real-clock guard refuses checks within five minutes of a period boundary rather than silently skipping. The schema’s eleven-history-row probe proves limits stay outside SQL; service configuration overrides require separate backend integration coverage.

Early discovery/typecheck invocations encountered PowerShell `@t12` splatting, batch regex-pipe quoting and TS6 CLI configuration issues. Correctly quoted direct-native-Node discovery and final project-wide TypeScript passed. The supplemental SQL evidence extractor initially included intervening TypeScript instead of one template; correcting it to stop at the template’s backtick separates that probe-script error from the actual E82 SQL. No product or acceptance test was weakened to bypass these tool errors.

Final cleanup verified zero harness roles, schemas and client connections, no browser-service listeners on 18080/3100, and stopped only the PostgreSQL cluster started for this task.
