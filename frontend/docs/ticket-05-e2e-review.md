# Ticket 05 E2E review evidence

Historical test-first review record (2026-10-17 to 2026-10-19). The implementation and runtime-pending statements below describe that review snapshot. Ticket 05 production code and cumulative acceptance were subsequently delivered on 2026-10-20; current completion evidence lives in the main checkout ticket folder, including evidence/2026-10-23-final-verification.md.

Status at the end of the test-first review: eight review/validation rounds complete: the initial five plus three additional rounds. Review began 2026-10-17 and finished 2026-10-19 (Asia/Dhaka). Validated findings are fixed; product runtime acceptance remains pending implementation.

## Scope and protocol

Worktree: `D:/Web Dev/medi-wish-bd-worktrees/ticket-05-secondary-email-recovery`, branch `ticket-05-secondary-email-recovery`, HEAD `13968d1d9674e6a151045b1d1bd9b5e5d318b1e3` plus uncommitted test-first work. Existing WIP was preserved; no production implementation, commit, push or merge is part of this review.

The temporary manifest divided the tests into independently owned sections: A recovery API acceptance and mirror; B browser journeys and mirror; C captured mail, guarded SQL, API startup/teardown, shared layout helpers, affected Ticket 11 browser cases, helper units and mirrors. Every round uses fresh `gpt-6-sol` High reviewers, followed by `gpt-6-sol` Medium validators/fixers who challenge validity and necessity. The initial request allowed five rounds; the follow-up requested three additional rounds, recorded below. Two consecutive rounds with no significant validated findings end a loop early. Significant means a material false pass/failure, acceptance blind spot, unsafe fixture effect, flakiness, privacy or resource defect; style and unsupported speculation do not count.

Authority: Ticket 05 story and implementation plan in the main checkout's `.scratch/launch-reconciliation/ticket-drafts/05 - Recover an account through the existing secondary email route/`. Plan section 3.2 **Answers** overrides the preceding proposal table: five wrong current passwords per hour, one shared five-code hourly limit and 60-second gap, and email changes revoke other sessions.

## Round decisions

| Round | Validated significant section findings A / B / C | Disposition |
| --- | --- | --- |
| 1 | 3 / 3 / 2 | Fixed; code-collision and log-scan findings overlap sections. |
| 2 | 1 / 1 / 2 | Fixed; diagnostic changes overlap sections. One proposed B finding was rejected. |
| 3 | 1 / 1 / 1 | Fixed; C was independently found during Medium validation. |
| 4 | 1 / 1 / 0 | Fixed; a speculative C diagnostic finding was rejected. |
| 5 | 1 / 1 / 0 | Fixed; all five requested rounds completed. |

Round 1 corrected replacement and cross-purpose/account tests that assumed independently generated six-digit values always differ. UUID identities prove replacement; old-digit rejection runs when values differ, while current-code success remains required. It added a FIFO mail sentinel before an exact notice count, exercised a real name save with the saved email re-cased, migrated the specifically listed Ticket 11 browser locators/password/chip assertions, strengthened dialog overflow checks, and removed raw response-status messages and delimiter-blind code log scans. A standalone Chrome fixture at 375 px measured document overflow **0 px** and dialog overflow **400 px**, reproducing the layout blind spot.

Round 2 added focused mail-directory, malformed capture, sorting/filtering, delayed/nth/deadline mail, sentinel, code parsing and pre-SQL guard units. It replaced whole-surface privacy matcher operands with booleans/counts and empty-body lengths. The dialog focus assertion now rejects a focused document body but allows native browser-chrome focus: both Chrome and Edge fixtures observed `BODY` with `document.hasFocus() === false` after the last modal control. The reported link-order inversion was rejected because the live source already used the correct `!== 0` comparison before validation; no link-order fix was made. A nested reset-email fixture was corrected as a minor issue.

Round 3 strengthened rate-limit suppression checks with live-row UUID comparisons and redemption of the last mailed code after hourly, address and shared-purpose refusals. Field errors must now resolve through `aria-describedby` to a visible element containing the expected message; a standalone Chrome fixture rejected unlinked, missing and hidden descriptions and accepted a visible linked error. Shared layout and keyboard failure diagnostics now report safe control positions/tags instead of input markup. Keyboard order still rejects unexpected focused controls and checks every expected position and focus ring.

Round 4 closed the immediate-gap branch left by round 3: reset and verification refusals now compare a secret-free fingerprint of the complete live code row before later replacement can hide in-place mutation. The privacy journey now snapshots storage/history while the verification dialog contains the entered code, as well as before and after verification. Medium C challenged a positive synthetic password equality assertion, then rejected the proposal consistently with the retained diagnostic boundary; its tentative change was reverted.

Round 5 added a full-row preservation check across the cross-purpose verification refusal after a reset issue, and a live-row prerequisite before the adjacent verification fingerprint comparison. The privacy journey now samples cookie names and values at the existing filled-field observations, including HttpOnly cookies, using count-only assertions. Only the established opaque `MW_REFRESH` value is excluded from six-digit substring matching when its HttpOnly flag, `/api/auth` path and 43-character base64url format match the current session implementation; email/password checks still include it. Section C's final High and independent Medium reviews found no significant defect. No two consecutive whole rounds were clean, so the loop ended at the requested five-round maximum.

## Verification

All commands run from this worktree's `frontend/`, unless specified. Unit-suite commands set `TEST_DB_HOST=127.0.0.1`, `TEST_DB_PORT=55433` and `VITEST_MAX_WORKERS=1`; the helper units mock SQL and do not connect to PostgreSQL.

| Gate | Result |
| --- | --- |
| Initial `npm run typecheck` | Passed. |
| Initial `npm run test:unit -- tests/testApi.test.ts` | 65/65 passed. |
| Round 1 integrated lint and typecheck | Passed. |
| Round 1 `npm run test:unit` | 955/955, 39 files passed. |
| Round 1 `npm run test:browser -- --list --grep '@t05\|@t11'` | 218 checks in four files, Chrome and Edge; collection only. |
| Round 2 focused helper units and ESLint | 22/22 units and focused lint passed. |
| Round 2 integrated `npm run verify` (2026-10-18) | Lint, typecheck, 972/972 units in 39 files and production build passed. |
| Round 2 `npm run test:browser -- --list --grep '@t05\|@t11'` | 218 checks in four files collected; no recovery runtime acceptance. |
| Integrated `npm run verify` after round 3 (2026-10-18) | Lint, typecheck, 972/972 units in 39 files and production build passed. Round 4 A/B spec-only changes overlapped this run; final settled-source checks are recorded separately. |
| Integrated Playwright collection after that build | 218 checks in four files collected. |
| Final settled-source `npm run lint`, `npm run typecheck`, then `npm run test:browser -- --list --grep '@t05\|@t11'` (2026-10-18) | All passed; 218 checks in four files collected after all five rounds. Source hashes below remained unchanged. |

An early lint command read a source file during an active patch and reported an incomplete file; the settled-source rerun passed. Sub-agent PATH and missing bundled-headless-shell attempts were environment failures; direct installed Node and stable Chrome worked. These attempts are not counted as passing gates.

## Runtime boundaries and remaining implementation gates

These tests were authored before Ticket 05 production. The recovery backend/schema/UI and `backend/target/medi-wish.jar` are absent. Full recovery E2E, live API integration/probe, and cumulative runtime acceptance have **not** passed and are not claimed by collection or standalone DOM fixtures. No API server or database cluster was started for this review.

Mail timing/async proof remains the assigned T7 gate: controlled request-path mail/password-encoder behavior, statement counts and the specified timing samples. A late-response-after-unmount browser proposal was not adopted because navigation can cancel the fetch before the component continuation; T3 needs a focused deferred-promise component test or demonstrably non-vacuous browser evidence. Original broader `profileApi.spec.ts`/`profileSupport.ts` migrations remain T4 implementation prerequisites under plan 10.5.

The plan's E2E-05-41 wording says a replacement has different digits, while its independent `SecureRandom.nextInt(1_000_000)` generator permits a repeated value. This review preserves the generator contract and proves issuance replacement by UUID; it does not add a distinct-value production rule or edit the read-only plan. Diagnostic improvements prevent whole-surface dumps from negative privacy assertions; ordinary positive synthetic contract assertions and Playwright locator diagnostics remain, so this is not a global secret-free-report guarantee.

Matching test documentation and the index are updated. All seven source files have a matching indexed documentation page. Thirty temporary section reports (five rounds × three sections × High/Medium) were checked before cleanup; this document retains their accepted/rejected decisions and verification boundaries. Temporary-artifact cleanup is recorded below. No changes were staged or committed.

## Source identity after the initial five rounds

Historical SHA-256 after the initial five rounds at unchanged HEAD `13968d1d9674e6a151045b1d1bd9b5e5d318b1e3` (uncommitted tests included); the additional-round identities below supersede these:

| Source | SHA-256 |
| --- | --- |
| `frontend/tests/browser/recoveryApi.spec.ts` | `A3ECF8F5A4B8655639D15B48B3752D755B873831BEFC8554C0C161EBFAF81126` |
| `frontend/tests/browser/recovery.spec.ts` | `A165D7D31F1047BEEE37FB13AC3AF26AD80EEB97B512190B2D7CC3608EB30560` |
| `frontend/tests/browser/recoverySupport.ts` | `B254CF1295A944D07E9017FC69E10855DDFA2A08BEE6FA41028B087A34030D2A` |
| `frontend/tests/browser/profile.spec.ts` | `CA14A26370E15F0D3B6293C5E49DF0A99C941F58BDDCB0AD32F5A4797B37D65A` |
| `frontend/tests/browser/testApi.ts` | `DA08FFFEC4317B7D1C64BAA607F6B3813D691BF38E5E73C91532809FA4118E51` |
| `frontend/tests/testApi.test.ts` | `AA86E9919C02846C051EF595A6B597D8CD428AF1CF537FBB8E4EDAA0B1C8D341` |
| `frontend/tests/recoverySupport.test.ts` | `42F91DA1E71239E186F56C49675122DF85B3ECB0C11923BC4DB26F402C5D0B2F` |

## Cleanup after the initial five rounds

On 2026-10-18, verified the exact task-owned `.scratch/ticket-05-e2e-review` absolute path and its 32 expected files (manifest, source-hash snapshot and 30 section reports), then removed that directory. `Test-Path` returned `False`. Final `git diff --check` passed; source, mirrors, index, durable evidence and lifecycle entry remain local and uncommitted. No API/database server was started and no other task process or resource was stopped.

## Additional review requested 2026-10-18: rounds 6–8

The user requested up to three more iterations of the same sectioned High review / independent Medium validation-and-fix protocol, stopping after two consecutive additional whole rounds without significant validated findings. The same A/B/C ownership is recorded in a new temporary manifest under `.scratch/ticket-05-e2e-review-extra`; existing WIP and HEAD are preserved. The previous five rounds above remain historical evidence.

Initial helper baseline: `npm run test:unit -- tests/recoverySupport.test.ts tests/testApi.test.ts` passed **87/87** tests in two files with `TEST_DB_HOST=127.0.0.1`, `TEST_DB_PORT=55433`, `VITEST_MAX_WORKERS=1`. Node/npm were resolved through `C:/Program Files/nodejs` for this shell; an initial `Get-Command npm` lookup failed before setting PATH. Live inspection still found no recovery production sources/routes or backend jar, so full recovery runtime acceptance remains unrun.

All three additional rounds are complete. Each section received a fresh High review and an independent Medium validation/fix pass; interrupted agents resumed their assigned pass after the usage reset. There were no two consecutive clean whole rounds, so this loop ended at its requested three-round maximum.

| Additional round | High findings A / B / C | Validated significant findings A / B / C | Disposition |
| --- | --- | --- | --- |
| 6 | 0 / 0 / 3 | 0 / 0 / 3 | Two High proposals and one independently reproduced adjacent focus defect fixed; mail-order proposal rejected. |
| 7 | 0 / 0 / 1 | 0 / 0 / 1 | PostgreSQL routing boundary fixed and regression-covered. |
| 8 | 0 / 0 / 1 | 0 / 0 / 1 | Three filled-field privacy observations added. |

### Round 6 decisions

High findings A/B/C: 0/0/3; independent Medium validated significant findings A/B/C: **0/0/3**. Section C accepted two High proposals (44 px input width and pre-save Current password storage) plus an adjacent profile modal focus defect raised by root and independently reproduced by Medium. Minimal fixes and matching mirrors are integrated. Standalone Chrome fixtures showed the old width predicate passing a 20×44 px input and the old focus predicate passing focused BODY; the corrected predicates rejected both. No new test abstraction or transport implementation was added.

The mail filename tie proposal was rejected as a necessary implementation change: plan §6 explicitly acknowledges random order within a millisecond, and no affected authored same-address/same-kind case was demonstrated. Tests use `ageLimits(..., 61)` rather than a real 60-second wait, so the production gap alone is not proof of wall-clock timestamp separation during fixtures; a deterministic tie would require revisiting the fixture, not inventing a new capture transport contract. Helper comments and mirror now accurately call the result filename order and state the tie limitation. Section A/B Medium validators independently confirmed zero findings. Full integrated verification is running before round 7.

Round 6 integrated verification completed successfully on 2026-10-18: `npm run verify` passed lint, typecheck, **972/972 unit tests in 39 files**, and the production Next.js build. The subsequent `npm run test:browser -- --list --grep ''@t05|@t11''` passed and collected **218** checks in four files across Chrome/Edge. These commands ran after round-6 source edits settled, while round-7 High agents performed read-only review. No API/database server was started. Source hashes were saved on resumption for the final unchanged-source check.

The usage limit then interrupted round-7 A/B Medium and C High agents; it also prevented automatic approval review of an evidence write, so that write was not executed. On 2026-10-19 the user requested continuation, live usage availability was confirmed, saved worktree/report state was inspected, and the three interrupted agents were resumed without repeating completed rounds.

### Round 7 decisions

High findings A/B/C: 0/0/1; independent Medium validated significant findings A/B/C: **0/0/1**. The C validator confirmed a P1 fixture boundary defect from PostgreSQL 18's host/hostaddr rules: inherited `PGHOSTADDR` can override the actual network destination despite the explicit loopback `-h`, and inherited `PGSERVICE` can supply a hostaddr indirectly. Both `psql` and `rolledBackSql` now pass a child environment filtering those two routing variables case-insensitively. `PGSERVICEFILE` without a service selection is inert; supported `PGPASSWORD`, `PSQL`, and `TEST_DB_ADMIN` remain available and the parent environment is unchanged. Four mock regression variants exercise both SQL paths, including lowercase inherited keys, without any live connection. Matching harness/unit mirrors and the index are updated. Section A and B independent validation remained clean.

Authority checked by High and Medium: PostgreSQL 18 [environment variables](https://www.postgresql.org/docs/18/libpq-envars.html) and [host/hostaddr rules](https://www.postgresql.org/docs/18/libpq-connect.html). No remote database was contacted. The final integrated verification below supersedes the earlier source identities for the changed harness files.

### Integrated verification after round 7 (2026-10-19)

`npm run verify` passed lint, typecheck, **976/976 unit tests in 39 files**, and the production Next.js build. The increase from 972 is the four inherited PostgreSQL routing regression variants. Subsequent `npm run test:browser -- --list --grep ''@t05|@t11''` passed and collected **218** checks in four files. All seven reviewed source SHA-256 hashes were unchanged from the snapshot taken before this command until after completion. Round-8 High/Medium reviewers read sources during the run; the final Section C edits were explicitly held until it completed. No API/database server or live recovery runtime was involved.

### Round 8 decisions

High findings A/B/C: 0/0/1; independent Medium validated significant findings A/B/C: **0/0/1**. Section C confirmed that E2E-11-46 tracked date of birth and duplicate/pending mobile values, but never sampled storage while each field held that value. Three calls to the existing `snapshotStorage()` now observe them before Save or stage can clear a transient write. The existing count-only encoded-form scan remains the assertion, and the mirror/index now describe filled-field observations. These are sampled observable states, not a claim to inspect every instant between snapshots. Section A/B remained clean, and Medium found no further defect in the SQL routing, layout, modal focus or accepted mail-order limitation. The final spec-only change was made after the integrated run above; settled-source checks are recorded next.

### Final settled-source checks and identity (2026-10-19)

After the last three browser-spec snapshot calls, `npm run lint`, `npm run typecheck`, and `npm run test:browser -- --list --grep '@t05|@t11'` all exited 0; collection remained **218** checks in four files. No unit or application source changed after the 976-test/build pass, so those suites were not repeated for the final browser-spec-only observations. The final seven source hashes matched the snapshot taken after that last edit; all seven have matching indexed documentation pages. `git diff --check` passed.

The unchanged HEAD remains `13968d1d9674e6a151045b1d1bd9b5e5d318b1e3`; these identities include uncommitted test-first work and supersede the historical first-five-round table above.

| Source | SHA-256 |
| --- | --- |
| `frontend/tests/browser/recoveryApi.spec.ts` | `A3ECF8F5A4B8655639D15B48B3752D755B873831BEFC8554C0C161EBFAF81126` |
| `frontend/tests/browser/recovery.spec.ts` | `A165D7D31F1047BEEE37FB13AC3AF26AD80EEB97B512190B2D7CC3608EB30560` |
| `frontend/tests/browser/recoverySupport.ts` | `1263AB5D708758B9E5289133ED9CE13A3346B6224D2C9C44ED383A4C6B97954D` |
| `frontend/tests/browser/profile.spec.ts` | `CFCF6AF7F2B7348C3EB839CCD5E269A88A473F313E33D817C309670C530D3D15` |
| `frontend/tests/browser/testApi.ts` | `315290A70B7A9D69D3706350C017D3AEEE5693E02F3AD1A1DBE42846E1371854` |
| `frontend/tests/testApi.test.ts` | `234E1DBE46655AF533A9F01B772A19B1BC34EFEC4D6C055D5F58097FC0DC2D92` |
| `frontend/tests/recoverySupport.test.ts` | `42F91DA1E71239E186F56C49675122DF85B3ECB0C11923BC4DB26F402C5D0B2F` |

### Additional-round cleanup and delivery boundary

On 2026-10-19, checked the exact absolute `.scratch/ticket-05-e2e-review-extra` directory and its **23 allow-listed task-owned files**: the manifest, four source-hash snapshots and eighteen completed reports (three rounds × three sections × High/Medium). There were no subdirectories or unexpected files. Removed that directory; `Test-Path` returned `False`. Durable decisions, verification commands, final source hashes and pending runtime gates remain here, with matching mirrors/index and the lifecycle entry. All five validated additional findings are addressed; no two consecutive additional whole rounds were clean, so the requested maximum of three additional rounds was used.

No files were staged or committed, and no push, merge, deployment or production implementation was performed. Existing WIP was preserved. No API/database server was started, and no other task process or resource was stopped. Full recovery E2E, live integration/probe and cumulative runtime acceptance remain unrun for the production-absent reason above.
