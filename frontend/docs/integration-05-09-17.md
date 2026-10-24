# Tickets 05, 09 and 17 integrated frontend evidence

Updated 2026-10-24 (Asia/Dhaka). Final executable candidate: **`dd70d7f8ce8a3ade298dd9de365420e1af7a1256`** on `codex/integrate-tickets-05-09-17`. Fresh frontend verification, live clients, full cumulative browser, smoke, demonstrations and the subsequent user-required in-app browser UI gate passed. Final task cleanup passed. **Accepted for the authorized local dev integration**. The [promotion manifest](../../.scratch/merge-05-09-17-20261023/promotion.json) records the resulting branch revision after guarded fast-forward. See the [backend record](../../backend/docs/integration-05-09-17.md) for retained Maven/migration gates at `3e48b13` and exact backend-input parity proof.

## Inputs and visible contracts

| Input | Frozen revision |
| --- | --- |
| Local dev baseline | `13968d1d9674e6a151045b1d1bd9b5e5d318b1e3` |
| Ticket 05 | `145073f18c0c29eb519d1da7c31b0ce7041c301c` |
| Ticket 09 | `93f9c6a91080266acff8d341f09cee3e0c19fba9` |
| Ticket 17, including latest review fixes | `45e524826385d326aefb507f79353a077f0f6f65` |

The candidate combines profile email verification, password-confirmed email changes, guest reset with a sign-in notice, restricted staff backup-code replacement/regeneration, and request-time anonymous Category/Product browsing. Session tests retain reset-notice lifetime and replacement assurance/generation contracts. Styles retain recovery controls, current-category marks, focus rings, breadcrumb scope and readable sale-unit copy. Public reads do not broaden protected commands.

Replacement `SENT`/`FAILED` copy describes verified contacts without revealing recipients. The backend sends code-free notices to eligible verified mobile/email after commit with bounded aggregation; `3e48b13` preserves an already-consumed success if a later wait is interrupted. Real outbound providers, durable retries, mobile OTP, cart and orders remain deferred. Ticket 17's formal parent closure and Tickets 15/16 tracker acceptance/disposition remain separate; their implementations are ancestors of the frozen dev baseline.

## Completed current checks

Runtime: Node 24.18.0, npm 11.16.0; no dependency installation or lockfile change. Guarded frontend verification supplies explicit loopback database routing. Live/browser gates use API 18115, production frontend 3115 and PostgreSQL 18 UTF8 on 55433, with isolated roles/schemas, capture mail and local storage. Builds and runtime work are serialized.

| Gate | Source/date | Actual result / evidence |
| --- | --- | --- |
| Fresh full `npm run verify` | `dd70d7f`, 2026-10-24 07:54:48–07:57:36 +06:00 | PASS: lint/typecheck, 1,208 units in 49 files and production build; `frontend-verify-accepted.log`, `frontend-verify-accepted-result.json`, exit 0 |
| Fresh live integration and health probe | `dd70d7f`, completed 2026-10-24 07:58:15 +06:00 | PASS: 14 integration tests in 9 files, liveness/readiness `up`, exit 0; `frontend-live-accepted.log` |

The [live runtime metadata](../../.scratch/merge-05-09-17-20261023/frontend-live-accepted-runtime.json) records revision `dd70d7f8ce8a3ade298dd9de365420e1af7a1256`, jar SHA-256 **`342E52DD8B4E94C1CB3F3DFD914293B3579F4343FEE15EE1C5E8181112C2A9BC`**, build ID `y9LgCyvlZp_j-l-QrJ9xx` and completion `2026-10-24T07:58:15.8117882+06:00`. Later runtime builds/identities belong to their own invocation; no Maven build may replace a serving jar during live checks.

All 386 backend executable inputs remain unchanged from completed backend verification at `3e48b1393aaf65eb49002384f1102233442240fb`, as recorded in [backend parity metadata](../../.scratch/merge-05-09-17-20261023/backend-verification-parity.json) and the saved verified-source revision/hash manifest. The four retained backend gates keep their original tested revision; fresh frontend verification above covers the browser-only test correction on `dd70d7f`.

## Completed automated runtime acceptance

| Gate | Local evidence label | Actual result, 2026-10-24 Asia/Dhaka |
| --- | --- | --- |
| Full cumulative Chrome/Edge | `browser-cumulative-accepted` | PASS: 1,376 passed and 6 intentional skips out of 1,382 executions; zero unexpected/flaky/global errors, exit 0; 07:58:36–09:04:49, 66.2 minutes |
| Separate smoke | `browser-smoke-accepted` | PASS: 20 passed, zero skips/unexpected/flaky/global errors, exit 0; 09:05:18–09:07:40, 141.4 seconds |
| Ticket 17 `E2E-17-22` demonstration | `ticket17-demo-accepted` | PASS: 2 passed, zero skips/unexpected/flaky/global errors, exit 0; 09:08:02–09:08:52, 49.7 seconds; 16 PNGs across Chrome/Edge |
| Tickets 05/09 reviewer demonstrations | `reviewer-demos-accepted.log` and [results](../../.scratch/merge-05-09-17-20261023/reviewer-demo-2026-10-24T03-08-52-466Z/results.json) | PASS: both phases; Ticket 05's 16 numbered steps (13a/13b), Ticket 09's 6 steps including captured verified-email notice; 09:09:09–09:11:35; 10 and 4 PNGs respectively |

The [accepted runtime sequence](../../.scratch/merge-05-09-17-20261023/run-accepted-browser.ps1) runs fresh full frontend verification, live clients, full browser, smoke, Ticket 17 demo and the combined reviewer runner in order. Preserve each `*-accepted` report/runtime pair, API log and copied attachments together. The reviewer runner starts its own guarded API/production frontend after earlier resources are released. Codes/passwords and captured bodies remain synthetic fixture data in memory/temporary mail; screenshots can contain synthetic once-only backup codes. Preparing or partially running a demonstration does not establish a pass.

Each browser invocation rebuilt the jar and frontend; identities therefore differ across runs. The wrapper checks that its serving jar does not change within each invocation. All runtime/reviewer revisions are `dd70d7f8ce8a3ade298dd9de365420e1af7a1256`.

| Invocation | Jar SHA-256 | Frontend build ID |
| --- | --- | --- |
| Full cumulative | `23EE3CD4D4C86FCF389469D107E813FFACC5D88BDD0313C630D1DEACB1E38283` | `ozhf_DvCrm0h9N0SwImcQ` |
| Smoke | `F50AF3227AC447CC401D56742F21C90EE1BBDA638024FEB05F71F331313D00CC` | `sH2vAehmQX71JOQNUEwGN` |
| Ticket 17 demo and subsequent Tickets 05/09 reviewer | `7709BD5019EE0FE8A52AB4E17B93C2DB7DF9563473918D690431743585D2792A` | `vi6e1d9ArD4YkTBgPU3Kc` |

Reports and identities use `<label>-report.json` and `<label>-runtime.json`; preserved attachments use `<label>-test-results/`. Ticket 17 also retains its [demo images](../../.scratch/merge-05-09-17-20261023/demo/). The [reviewer folder](../../.scratch/merge-05-09-17-20261023/reviewer-demo-2026-10-24T03-08-52-466Z/) contains Ticket 05 `steps.md`, Ticket 09 `steps.json` and screenshots. Its manifest reports both phases passed plus `frontendStopped`, `apiSchemaMailStorageReleased` and `apiPortReleased` true. That confirms the reviewer's own resource release; final task-wide cleanup remains separate.

## Additional in-app browser UI gate

Actual in-app browser (`iab`) UI testing ran after automated acceptance and before dev merge on 2026-10-24. All **12 observed checks passed**, as recorded in the [observations](../../.scratch/merge-05-09-17-20261023/iab-checks-observed.json):

- Ticket 17: home lists the active category; the category shows 24 priced products and a pager; Next shows only product 25 with Previous; detail shows price, MRP, sale unit and About; an unknown product shows the bounded not-found page.
- Ticket 05: invalid recovery email shows inline validation; reset request shows the generic acknowledgement and code form. A synthetic `PASSWORD_RESET_CODE` message was captured.
- Ticket 09: password sign-in requires MFA; the backup dialog focuses its code field; malformed input shows an inline error; Cancel restores focus to Lost your phone; a valid backup code reaches restricted replacement setup.

Screenshots: [product](../../.scratch/merge-05-09-17-20261023/iab-product.png), [recovery](../../.scratch/merge-05-09-17-20261023/iab-recovery.png), [staff replacement](../../.scratch/merge-05-09-17-20261023/iab-staff-replacement.png). The [runtime manifest](../../.scratch/merge-05-09-17-20261023/iab-runtime-2026-10-24T10-00-10-560Z/results.json) pins `dd70d7f`, the Ticket 17/reviewer jar and build ID above, and 16:00:10–16:05:17 +06:00. It records release of its frontend/API/schema/mail/storage resources; observed UI checks are recorded separately.

The initial runtime seed rejected an unknown PUT field; only the synthetic fixture was corrected before the ready second run identified by `iab-runtime.log`. Ten-second test access tokens expired during paused manual attempts; reauthentication followed by uninterrupted valid redemption succeeded. Credential-changing password-reset and authenticator-replacement completion was covered by the full automated demonstrations and was not repeated in this manual smoke.

## Historical attempts and corrections

- The first frontend verification lacked guarded database routing: 1,200 units passed and six address-helper cases failed. A guarded rerun passed 1,206; after `25396f0` added the replacement-notice mail kind/parser regression, full verification passed 1,208. Retained logs: `frontend-verify.log`, `frontend-verify-guarded.log`, `frontend-verify-final.log`. No address assertion was weakened.
- The first cumulative browser attempt recorded `ERR_NETWORK_IO_SUSPENDED` in E2E-14-05 and a subsequent navigation failure in E2E-14-06. It was stopped incomplete; `browser-cumulative-aborted*` retains evidence. The symptom does not prove an application defect or operating-system cause.
- A second invocation passed those navigation cases but was stopped incomplete when the notice-interruption correction required fresh runtime acceptance. Artifacts use `browser-cumulative-superseded*`. Neither interrupted run establishes a cumulative pass; identified runner trees, roles/schemas and exact mail/storage namespaces were released separately.
- The `browser-cumulative-current` invocation then failed E2E-09-02's outdated focus expectation after locked-dialog Cancel. The two-browser focused red run failed twice at the absent trigger. Frozen `93f9c6a` intentionally focuses the parent lockout alert, hides that trigger and disables challenge controls. Browser-only commit `dd70d7f` corrects the assertion and its mirror/index while retaining TOTP 429, throttle and unspent-code checks. The ordinary-close/locked-close/locked-challenge focused group passed all six cases. No production behavior changed. The [diagnosis](../../.scratch/merge-05-09-17-20261023/lockout-focus-diagnosis.md) and `browser-cumulative-lockout-failed*` retain the incomplete known-red run and exact owned cleanup evidence. The separate full accepted run above verifies the corrected candidate cumulatively.
- Backend password-fixture/MFA-test corrections and the production interruption fix are covered in the backend record. Earlier `a77c4fa` live passes are historical; current live evidence above uses `dd70d7f`, while unchanged backend gates retain `3e48b13` through exact input parity.

## Evidence and remaining delivery boundary

Local evidence: [`.scratch/merge-05-09-17-20261023/`](../../.scratch/merge-05-09-17-20261023/). Automated and subsequent in-app UI results, identities and attachments are recorded above. Final [cleanup](../../.scratch/merge-05-09-17-20261023/cleanup.json) passed at 16:06:16 +06:00: zero test roles/schemas/sessions, no new residual directories, application ports released, owned PostgreSQL PID 51792 stopped and port 55433 released. Structural tracker validation passed at 16:08:24 +06:00: 64 stories, 496 children, 4,113 links and zero failures. Documentation is finalized on the integration branch; staged-diff validation precedes its documentation-only commit. The guarded [promotion manifest](../../.scratch/merge-05-09-17-20261023/promotion.json) records the resulting dev revision and requires all acceptance, source parity, IAB and cleanup gates before branch mutation. No push or deployment has been performed.

The final inspector passed and its [summary](../../.scratch/merge-05-09-17-20261023/verification-summary.json) pins accepted frontend/live/browser gates to the final `dd70d7f` manifest, and retained backend gates to `3e48b13` with exact backend parity. It verifies required totals plus exact file membership/hashes for 611 executable inputs, including all 386 backend inputs. Ignored local logs/reports/demonstration artifacts are not Git-delivered evidence. The promotion guard rechecks executable parity, all acceptance gates, source-worktree cleanliness and frozen input refs immediately before fast-forward; its manifest and local lifecycle record preserve the actual result.
