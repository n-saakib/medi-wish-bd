# Ticket 12 E2E review

Review date: 2026-10-11. Branch: `ticket-12-delivery-addresses`. Source baseline: `7555e2d0654c9ade2edff9d44465553f565b3413` plus the existing uncommitted acceptance tests and the corrections recorded here. No commit, merge or deployment is part of this review.

Completed five sequential rounds, each with two independent sub-agent reviewers followed by two separate sub-agents that validate the findings and make bounded corrections. The acceptance contract is the main checkout's accepted Ticket 12 implementation plan, decisions A1–A10 and parent AC1–AC7. Production address routes, page and migration are absent; these remain executable acceptance gates for future implementation.

## Findings and dispositions

| Round | Confirmed problem | Disposition |
| --- | --- | --- |
| 1 | API response/database agreement could pass despite incorrect submitted values or a changed losing row in a race. | Create and concurrency assertions now compare complete expected rows with submitted intent, exact versions and unchanged losing rows. |
| 1 | Create-with-default cases derived the expected default from the server response. | Create helper asserts requested default, demotion/version of the old default and unchanged other rows. |
| 1 | Successor tests never exercised equal creation timestamps or PostgreSQL/Java UUID ordering differences. | Guarded synthetic timestamp tie across `7fff…`/`8000…` IDs proves GET order and promotion. |
| 1 | Control validation omitted Unicode C1 controls. | Added U+0085 to POST/PUT rejection matrix. |
| 1 | Browser privacy scan ran only after reload and omitted exact edited values. | Scan open Add/Edit drafts, post-save state and reload for both full fixtures. |
| 1 | Accessible field descriptions could contain only an unrelated hint. | Require newly visible/nonempty linked error text; support predeclared error elements. |
| 1 | Keyboard/modal and pending-edit oracles were weak. | Assert initial focus, reverse trapping, repeated form submissions and final dispatch count. |
| 1 | Late-read title overstated session-generation proof; optional demo mixed old logs with new images. | Narrow account-switch claim and retain mandatory mounted unit gate; reset each demo's step log. |
| 2 | Old-session test incorrectly required successful delivery after unmount. | Observe exact old request completion or cancellation; neither may expose the previous book. |
| 2 | Unknown-outcome dialog closing covered only network errors. | Cancel/Escape matrix now includes committed creates followed by network loss, substituted 500 and actual client timeout. |
| 2 | Malformed success coverage checked only an extra top-level GET key. | Twelve nested/missing/type/bounds GET variants and a corrupted committed-create reply with same-id replay recovery. |
| 2 | Schema tests did not prove default values or client-generated IDs. | Rollback probes assert omitted fields produce `false:0` and omitted id fails. |
| 2 | Capacity and default/delete races could accept corrupted winner/loser fields. | Assert complete request-derived response and persistent outcomes. |
| 2 | ASCII-only body fixtures could pass a character-count limit. | Bengali bodies prove exact 16,384/16,385 UTF8 byte boundaries for POST/PUT. |
| 3 | Privileged staff foreign ownership checks were missing; own GET was checked only for shape. | Assert staff → Customer and Customer → staff isolation, foreign/missing 404s, exact own GET and both books/counts unchanged. |
| 3 | Wrong-root JSON string fixture sent invalid JSON; preauthorization PUT size filtering was untested. | Send valid JSON string/boolean roots; anonymous PUT at 16,384 bytes gives 401 and 16,385 gives bounded 400. |
| 3 | Busy command covered only PUT and counted only that method. | POST/PUT/DELETE gates exercise repeated submits and competing/close actions; assert the complete dispatch list and exact durable result. |
| 3 | Browser required/digit validation and blocked Add during reconciliation were incomplete. | Seven invalid fields × Add/Edit prove retained drafts, linked errors, zero mutations and corrected saves; held reconciliation GET keeps Add unavailable. |
| 4 | Label association did not prove visibility; keyboard tests skipped enabled Default and confirmation. | Assert visible associated labels and keyboard default/Keep/Remove flows. |
| 4 | Touch targets omitted Add, checkbox label and confirmation; layout fixtures were short. | Assert complete 44px actions and accepted maximum-length/unbroken/Bengali text at both widths. |
| 4 | Partial demo reruns retained stale screenshots alongside a new log; relative artifact roots were accepted. | Unique per-project run directory under a required absolute artifact root, preserving earlier evidence. |
| 4 | Demo create/edit/delete could restore unrelated-table fingerprints before the single final comparison. | Compare unrelated-table fingerprints after each command. |
| 5 | Every divergent-create fixture changed city, leaving the other replay identity fields unchecked. | Added five individual field conflicts, each preserving the full book and change log. |
| 5 | Closure versus field-validation precedence was proved only for POST. | Added PUT extra-key parsing refusal before closure and blank-city closure refusal before validation. |
| 5 | Deleting a card required an undocumented exact Add focus fallback. | Remove the exact destination requirement; prove continued keyboard navigation outside the closed dialog. |
| 5 | Client text-control validation was missing. | Add retained U+0085 Name fixtures to both Add/Edit zero-command validation cases. |
| 5 | Demo capacity log said two slots although two addresses already existed. | Correct the evidence text to one remaining slot. |
| 5 | Mandatory browser write-boundary case also compared only the net result of three commands. | Assert unrelated-table fingerprints after each browser create, edit and delete, matching the strengthened demo. |

The corrected sources and their matching documentation are [browser journeys](../tests/browser/addresses.spec.ts), [API cases](../tests/browser/addressesApi.spec.ts), [installed-schema checks](../tests/browser/addressesDatabase.spec.ts) and [optional demo](../tests/browser/addressesDemo.spec.ts). Shared address helpers and their 28 unit cases were reviewed and retained.

## Verification

Baseline address helper units passed: `node.exe node_modules/vitest/vitest.mjs run --project unit tests/addressSupport.test.ts`, 28/28. Baseline typecheck and Ticket 12 discovery passed. Round 1 API corrections passed native TypeScript, focused ESLint and API/database discovery (82 checks across two browser channels). These results establish test syntax and helper behavior, not address-feature acceptance.

Live representative check after Round 1: backend `powershell.exe -NoProfile -Command '& .\mvnw.cmd -o -q package -DskipTests; exit $LASTEXITCODE'` passed (package only, no backend tests). Native Playwright `test --grep 'E2E-12-(15 |80 )' --reporter=json` ran both Chrome and Edge: four feature failures, zero skips and no setup errors, exit 1. Both smoke cases timed out at the missing Addresses link; both schema cases failed the explicit missing-017-tables assertion. Report: ignored `.scratch/ticket12-e2e-review/live-representative.json` in this worktree. Harness cleanup verified zero browser roles/schemas/client connections and no browser-port listeners; stopped only this review's newly started UTF8 cluster.

Round 2 corrections passed native TypeScript and focused ESLint for the changed browser/API/database specs. Round 3 corrections passed native TypeScript, focused ESLint, API discovery (74 checks) and selected validation/recovery/command discovery (46 checks). Round 4 corrections passed native TypeScript and ESLint; Round 5 separately validated every finding against the contract and passed native TypeScript, scoped ESLint, API discovery (74 checks) and selected browser/demo discovery (36 checks). The final integration correction to mandatory browser write-boundary case 14 also passed native TypeScript, scoped ESLint and focused Chrome/Edge discovery (2 checks).

Final integrated evidence on 2026-10-11, at the baseline HEAD plus the uncommitted corrected tests:

| Command / check | Actual result |
| --- | --- |
| `powershell.exe -NoProfile -Command '$env:VITEST_MAX_WORKERS = "1"; & npm.cmd run verify; exit $LASTEXITCODE'` | Exit 0: full ESLint, TypeScript, 531/531 units in 26 files (including 28 address-helper units), Next production build. Run before the final test-only Round 5 corrections; those corrections subsequently passed TypeScript and scoped ESLint. No production code changed. |
| `node.exe node_modules/@playwright/test/cli.js test --grep @t12 --list --reporter=json` | Exit 0 after all corrections: 244 discovered checks, 122 each in Chrome/Edge. 242 acceptance checks and 2 optional demo instances, compared with 176 total before review. |
| Discovery report validation | No duplicate full titles within a channel; every acceptance check has exactly one delivery-gate tag. T2: 8, T5: 86, T6: 140, T7: 8 across both channels. File counts: UI 160, API 74, installed schema 8, demo 2. |
| Documentation/index parity and final whitespace | All six address sources have indexed mirrors; all four corrected specs have changed mirrors. Shared helper and helper-unit source files remain byte-for-byte unchanged. Native `git diff --check` and explicit whitespace checks of the untracked sources/mirrors passed. |

Ignored local reports are `.scratch/ticket12-e2e-review/discovery-final.json`, `discovery-final-summary.json`, `live-representative.json` and `source-sha256.txt` in this worktree. The manifest identifies the final six source files. The full corrected acceptance suite and optional demo remain unrun. Only the four representative browser/schema checks were executed; all failed because the production feature is absent. The earlier delivered-feature cumulative browser suite, backend tests, frontend API integration tests and probe were not rerun during this test review; their historical results in the original coverage record are not current-run evidence.

## Outstanding implementation gates

The plan assigns monthly limits, calendar rollover, configuration overrides, deterministic lock/closure races, forced rollback, restart and preceding-schema migration upgrade to backend units/integration tests. Those gates remain required and unrun here. The E2E account-switch journey does not replace a unit test that keeps the feature/session layer mounted and proves rejection of older session-generation replies. Order snapshots/manual checkout/post-order saving remain Ticket 25 scope; the current schema/write-boundary checks do not prove those journeys.
