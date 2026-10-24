# Tickets 05, 09 and 17 integrated frontend evidence

Prepared 2026-10-23 (Asia/Dhaka) on `codex/integrate-tickets-05-09-17`. **Status: validation in progress; required final results are PENDING.** Final verified source revision: **PENDING**. Final local dev revision: **PENDING**. Backend schema, service and Maven evidence is recorded [separately](../../backend/docs/integration-05-09-17.md).

## Candidate and visible behavior

| Input | Frozen revision |
| --- | --- |
| Local dev baseline | `13968d1d9674e6a151045b1d1bd9b5e5d318b1e3` |
| Ticket 05 | `145073f18c0c29eb519d1da7c31b0ce7041c301c` |
| Ticket 09 | `93f9c6a91080266acff8d341f09cee3e0c19fba9` |
| Ticket 17, including latest review fixes | `45e524826385d326aefb507f79353a077f0f6f65` |

The candidate combines profile email verification and password-confirmed email changes, guest password reset with a sign-in notice, staff backup-code redemption/replacement/regeneration, and request-time public category/Product browsing. Session-provider tests retain both reset-notice lifetime and replacement assurance/generation contracts. Shared styles retain recovery controls and storefront current-category marks, focus rings, breadcrumb scope and readable sale-unit copy. Public catalog reads do not broaden authenticated commands.

The staff replacement panel now describes verified contacts for `SENT` and `FAILED`, covering the integrated email/mobile delivery boundary without showing recipients. A successful channel makes `SENT`; captured messages and synthetic Users exercise this locally. Real outbound providers, durable notice retries, mobile OTP, cart and orders remain outside this merge.

Ticket 17 parent closure and Tickets 15/16 tracker acceptance/disposition remain separate decisions; their implementations are already ancestors of the frozen dev baseline. Historical individual-ticket browser counts do not establish acceptance of this combined candidate.

## Verification ledger

The verification runtime is Node 24.18.0 with npm 11.16.0 (supported Node 24/npm 11); no dependency installation or lockfile change was needed. Run lint, TypeScript, unit tests and production build with `npm run verify` from `frontend`. Use the guarded merge browser wrapper for cumulative/live gates; it records revision, jar SHA-256 and frontend build identity. API 18115, production frontend 3115 and guarded PostgreSQL 55433 use run-owned schemas, capture mail and storage namespaces. Heavy build/database/browser operations must remain serialized.

| Gate | Tested revision/date | Result |
| --- | --- | --- |
| Fresh full `npm run verify` after fixture correction | Frontend inputs at `25396f0`; unchanged by backend-only `8344a92`, 2026-10-23 | PASS: lint, typecheck, 1,208 units in 49 files and production build; `frontend-verify-final.log`, exit 0 |
| Full cumulative Chrome/Edge browser run | **PENDING** | **PENDING: passes, failures, skips, flaky cases and duration** |
| Separate smoke suite | **PENDING** | **PENDING** |
| Live frontend integration and health probe | `a77c4fa`, 2026-10-23 23:05 +06:00 | PASS: 14 integration tests in 9 files; health liveness/readiness up; `frontend-live.log` and `frontend-live-runtime.json`, exit 0 |
| Ticket 05 reviewer demonstration | **PENDING** | **PENDING: step transcript/screenshots and actual result** |
| Ticket 09 reviewer demonstration, including captured verified-email notice | **PENDING** | **PENDING: step transcript/screenshots and actual result** |
| Separate Ticket 17 `E2E-17-22` demonstration | **PENDING** | **PENDING: both browser results and attachments** |

Entry points from the repository root, to be reconciled with the final actual invocation logs:

```powershell
& .\.scratch\merge-05-09-17-20261023\browser.ps1 -Suite browser -Label browser-cumulative
& .\.scratch\merge-05-09-17-20261023\browser.ps1 -Suite browser -Grep '@smoke' -Label browser-smoke
& .\.scratch\merge-05-09-17-20261023\browser.ps1 -Suite integration -Label frontend-live
& .\.scratch\merge-05-09-17-20261023\browser.ps1 -Suite browser -Demo -Grep 'E2E-17-22' -Label ticket17-demo
```

The scratch reviewer runner executes Tickets 05 and 09 sequentially against one owned API/production frontend after the candidate jar/build are ready. Its invocation from `frontend` is `node ../.scratch/merge-05-09-17-20261023/run-reviewer-demos.mjs`. It records identities and cleanup; preparing it or authoring its steps is not a demo pass. Its build inputs must use API `http://127.0.0.1:18115`. No other Maven build may replace its serving jar during a live run.

## Failed attempts and fixture corrections
The first cumulative browser attempt recorded `ERR_NETWORK_IO_SUSPENDED` in E2E-14-05 and a subsequent navigation assertion failure in E2E-14-06. It was stopped as a known-red incomplete attempt on 2026-10-24 06:26 +06:00; no complete-suite pass is attributed to it. Its identified runner tree, role/schema `mw_browser_6917baff43d9` and exact mail/storage namespaces were stopped/removed. Retained evidence: `browser-cumulative-aborted.log`, `api-browser-cumulative-aborted.log`, `aborted-browser-processes.json` and `browser-cumulative-aborted-runtime.json`. A fresh complete Chrome/Edge invocation uses new fixtures; its result is recorded in the ledger above. The error records establish a suspended-network symptom, not a proven application defect or an inferred operating-system cause.

The first frontend verification omitted explicit guarded `TEST_DB_HOST=127.0.0.1` and `TEST_DB_PORT=55433`; six address-helper unit cases failed, with 1,200 passing. This was an invocation configuration error. The correctly guarded full rerun passed 1,206 units before the capture-kind correction, and the final guarded rerun passed 1,208 after it. Retained logs: `frontend-verify.log`, `frontend-verify-guarded.log`, `frontend-verify-final.log`. No address assertion was weakened.

Commit `5c2930e` keeps the backend integrated reset fixture within the existing 6–30 character password contract. Commit `25396f0` adds `STAFF_AUTHENTICATOR_REPLACED` to the captured-mail whitelist and a parser regression, preserving the four earlier kinds. Fresh frontend verification after that helper correction passed all 1,208 units plus lint/typecheck/build; `frontend-verify-final.log` preserves the invocation. Preserve earlier logs and report their actual failures; do not replace a failed cumulative result with totals accumulated from focused reruns.

The first backend default gate exposed an inherited MFA test timing flaw: enrollment crossed a 30-second step, so its alleged replay was a fresh code. Test-only commit `8344a92` uses the persisted accepted step. The fresh corrected default and compatibility backend gates both passed. Complete integrated acceptance still requires the browser/demo and cleanup gates in this ledger. See the backend record for diagnosis, correction and cumulative rerun evidence.

## Runtime identities, evidence and cleanup

Final browser source revision: **PENDING**. Served API jar SHA-256: **PENDING**. Production build IDs by invocation: **PENDING**. Final demo/browser attachment locations and raw report paths: **PENDING**.

Local evidence is retained under [`.scratch/merge-05-09-17-20261023/`](../../.scratch/merge-05-09-17-20261023/). Browser reports, invocation metadata, API logs and copied attachments must remain tied to their own run. Reviewer outputs have timestamped folders containing `results.json`, per-ticket runner/step files and screenshots. They contain synthetic fixture artifacts; live captured code bodies are confined to the temporary mail directory and removed by setup teardown. Ignored evidence files are local artifacts, not Git-delivered files.

Final cleanup of run-owned roles, schemas, sessions, capture mail and storage: **PENDING**. Final port 18115/3115/3116 checks and task-owned PostgreSQL disposition: **PENDING**. Final tracker validation, combined diff review and local dev promotion: **PENDING**. No push or deployment has been performed by this merge task.

## Confirmed interruption correction and fresh acceptance boundary

On 2026-10-24, a deterministic probe and Maven regression reproduced a lost successful notice outcome: the coordinator consumed `SENT`, then an interrupted second wait returned and audited `FAILED`. The minimal correction preserves the consumed aggregate when interruption is caught, while restoring interruption and cancelling unfinished work. The existing audit clear/restore behavior remains intact. The red regression recorded expected `SENT` / actual `FAILED`; the corrected full notice unit suite passed 18 cases (`notice-interruption-red.log`, `notice-interruption-green.log`). Reproducible diagnostic evidence is in `notice-interruption-diagnosis.md`.

**The backend and live passes above apply to the prior `a77c4fa` candidate. Fresh cumulative backend/live/browser acceptance for this production correction is PENDING and must supersede those results before dev promotion.** New invocation labels use `*-current`; the original passing/failed reports are retained. Frontend source inputs are unchanged, so the 1,208-unit/lint/typecheck/build result remains applicable through executable-input hash comparison.

The second browser invocation passed the formerly failing catalog-navigation cases but was stopped incomplete to supersede the pre-correction runtime. Its identified runner PID 22412, exact role/schema `mw_browser_15979c41a4ee` and mail/storage directories were released; retained artifacts use `browser-cumulative-superseded*`. It establishes no cumulative pass.
