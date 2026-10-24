# Tickets 05, 09 and 17 integrated backend evidence

Updated 2026-10-24 (Asia/Dhaka). Final executable candidate: **`dd70d7f8ce8a3ade298dd9de365420e1af7a1256`**, branch `codex/integrate-tickets-05-09-17`. Backend gates passed on unchanged backend inputs at `3e48b13`; fresh frontend/live, full browser, smoke, demonstrations and the subsequent user-required in-app browser UI checks passed on `dd70d7f`. Final task-wide cleanup passed. **Accepted for the authorized local dev integration**. The [promotion manifest](../../.scratch/merge-05-09-17-20261023/promotion.json) records the resulting branch revision after guarded fast-forward. See the [frontend record](../../frontend/docs/integration-05-09-17.md).

## Inputs and integrated contracts

| Input | Frozen revision |
| --- | --- |
| Local dev baseline | `13968d1d9674e6a151045b1d1bd9b5e5d318b1e3` |
| Ticket 05 secondary-email recovery | `145073f18c0c29eb519d1da7c31b0ce7041c301c` |
| Ticket 09 staff authenticator recovery | `93f9c6a91080266acff8d341f09cee3e0c19fba9` |
| Ticket 17 public catalog, including review fixes | `45e524826385d326aefb507f79353a077f0f6f65` |

Merge commits `f71dc90`, `b18c982` and `3a9c74a` retain histories in order 05, 09, 17. The candidate preserves password-confirmed email changes, verified-email reset with session revocation, restricted backup-code replacement sessions, public catalog GET-only access, bounded errors and request correlation. The [cross-ticket HTTP regression](src/test/java/bd/mediwish/auth/IntegratedRecoveryIT.java.md) checks reset/email-change revocation, saving-session preservation, anonymous catalog behavior with replacement/revoked bearer headers and protected profile/address denial.

Commit `627f451` integrates verified-email replacement notices with the verified-mobile notifier after replacement commits. Eligible channels share one bounded deadline. Any successful delivery yields `SENT`; otherwise failure precedes absent configuration, and no verified contact yields `NO_VERIFIED_CONTACT`. Notice/audit failure cannot roll back replacement or hide fresh codes. Commit `3e48b13` preserves an already-consumed success if the later channel wait is interrupted, retaining cancellation, interrupt restoration and the audit boundary. See the [coordinator documentation](src/main/java/bd/mediwish/auth/StaffReplacementNotices.java.md).

Real outbound SMS, hosted mail delivery, durable retries and mobile OTP remain deferred. Ticket 17's formal parent closure and Tickets 15/16 tracker acceptance/disposition remain separate gates; their implementations are ancestors of the frozen dev baseline. Historical individual-ticket results are not combined-candidate acceptance.

## Migration preservation

The combined changelog retains `018-staff-mfa-recovery` followed by `019-account-email-recovery` after `017-saved-addresses`; no changeset is renumbered. The [body audit](../../.scratch/merge-05-09-17-20261023/migration-body-audit.json) records unchanged original migration bodies. New nullable replacement/code-consumption evidence and email-verification state preserve existing rows; existing Users remain unverified. Current cumulative gates cover empty install, populated baseline and standalone-ticket upgrade/restart fixtures, including `CombinedRecoveryMigrationIT` with already-applied 019 advancing to the combined schema.

## Current backend gates

All four Maven rows use `3e48b1393aaf65eb49002384f1102233442240fb`, Java 25.0.4.1 and guarded PostgreSQL 18.6 UTF8 `medi_wish_test` on `127.0.0.1:55433`, with disposable roles and isolated schemas. The live-client row uses `dd70d7f`. Times are Asia/Dhaka on 2026-10-24. Maven invocations were serialized.

| Gate / command from backend | Time | Actual result / local evidence label |
| --- | --- | --- |
| Focused `-o verify -Dtest=StaffReplacementNoticesTest -Dit.test=CombinedRecoveryMigrationIT,IntegratedRecoveryIT,StaffReplacementNoticesIT` | 06:43:30–06:44:50 | BUILD SUCCESS: 18 units, 11 integration cases; `backend-notices-current` |
| Default `-o verify` | 06:44:51–07:00:45 | BUILD SUCCESS: 1,171 units; 433 integration passes and one expected compatibility-only skip; `backend-default-current` |
| Compatibility `-o -Pcompatibility verify` | 07:00:48–07:18:25 | BUILD SUCCESS: 1,171 units and all 434 integration cases, zero skips; `backend-compatibility-current` |
| Standalone `-o test` | 07:19:11–07:20:18 | BUILD SUCCESS: 1,171 units; `backend-unit-current` |
| Live frontend integration and probe, `dd70d7f` | Completed 07:58:15 | 14 integration tests in 9 files, liveness/readiness `up`, exit 0; `frontend-live-accepted` |

Every Maven row has zero failures/errors. Each backend label has its own `<label>.log`, `<label>-run.json`, `surefire-<label>/` and, for `verify`, `failsafe-<label>/` under the [evidence root](../../.scratch/merge-05-09-17-20261023/). Counts use fresh invocation reports. The [backend sequence](../../.scratch/merge-05-09-17-20261023/run-current-backend.ps1) ran focused/default/compatibility gates. The [accepted frontend sequence](../../.scratch/merge-05-09-17-20261023/run-accepted-browser.ps1) runs fresh full frontend verification, live clients and remaining browser/demo gates.

The [backend parity record](../../.scratch/merge-05-09-17-20261023/backend-verification-parity.json) identifies verified revision `3e48b13`, candidate `dd70d7f` and all 386 backend executable inputs with zero changes. The saved `backend-verified-source-revision.txt` and `backend-verified-source-hashes.json` preserve the verified baseline. Exact tracked backend file-set/hash equality is required before retaining these four backend results; the browser-test-only correction does not require rerunning unchanged backend gates.

The fresh [live metadata](../../.scratch/merge-05-09-17-20261023/frontend-live-accepted-runtime.json) pins revision `dd70d7f8ce8a3ade298dd9de365420e1af7a1256`, jar SHA-256 **`342E52DD8B4E94C1CB3F3DFD914293B3579F4343FEE15EE1C5E8181112C2A9BC`**, build ID `y9LgCyvlZp_j-l-QrJ9xx`, exit 0 and completion `2026-10-24T07:58:15.8117882+06:00`. Later runtime invocations require their own identities.

## Historical failures and corrections

- The initial integrated reset fixture exceeded the existing password-length contract; `5c2930e` corrected the synthetic password. Frontend fixture commit `25396f0` extended the captured-mail whitelist for replacement notices and added parser coverage.
- The first default backend run failed an inherited MFA replay assertion because enrollment crossed a time step and the alleged replay generated a fresh code. `8344a92` pins the persisted accepted step; `a77c4fa` fixes its missing import. The [diagnosis](../../.scratch/merge-05-09-17-20261023/mfa-replay-diagnosis.md), original failed run and focused compile failure remain retained. Earlier passing `a77c4fa` gates are historical.
- A deterministic probe subsequently reproduced lost `SENT` aggregation in that older production candidate. The red/green notice regression and [diagnosis](../../.scratch/merge-05-09-17-20261023/notice-interruption-diagnosis.md) support `3e48b13`; the current cumulative default/compatibility rows above verify the correction.
- The next cumulative browser invocation failed an outdated locked-dialog close assertion. Both-browser focused red reproduction failed twice; the corrected ordinary-close/locked-close/locked-challenge group passed all six cases. Commit `dd70d7f` updates only that browser assertion and its mirror/index to the frozen `93f9c6a` lockout behavior, retaining throttle/refusal checks. No production behavior changed. See [lockout diagnosis](../../.scratch/merge-05-09-17-20261023/lockout-focus-diagnosis.md); `browser-cumulative-lockout-failed*` retains the incomplete known-red invocation and exact owned cleanup evidence.

## Completed acceptance and local delivery

Automated runtime acceptance completed on 2026-10-24: full cumulative Chrome/Edge **1,376 passed / 6 intentional skips / zero unexpected or flaky**, separate smoke **20 passed**, Ticket 17 demonstration **2 passed**, and Tickets 05/09 reviewer phases both passed. The frontend record ties each result to its report/runtime identity. The [reviewer manifest](../../.scratch/merge-05-09-17-20261023/reviewer-demo-2026-10-24T03-08-52-466Z/results.json) records both phases passed and release of that runner's frontend/API/schema/mail/storage resources; this is scoped runner cleanup, not the final task-wide cleanup.

After automated checks and before dev merge, actual in-app browser UI testing passed all **12 observed checks**, covering public category/pagination/detail/not-found views, reset validation/request/captured-code delivery, and staff MFA dialog/restricted backup-code recovery. The [observations](../../.scratch/merge-05-09-17-20261023/iab-checks-observed.json) and frontend record define the scope. Credential-changing reset/replacement completion was covered by the full automated demonstrations rather than repeated in this manual smoke.

Final task-wide [cleanup](../../.scratch/merge-05-09-17-20261023/cleanup.json) passed at 2026-10-24 16:06:16 +06:00: zero test roles/schemas/sessions, no new residual directories, application ports released, owned PostgreSQL PID 51792 stopped and port 55433 released. Structural tracker validation passed at 16:08:24 +06:00: 64 stories, 496 children, 4,113 links and zero failures. Documentation is finalized on the integration branch; staged-diff validation precedes its documentation-only commit. The guarded [local promotion](../../.scratch/merge-05-09-17-20261023/promotion.json) records the resulting dev revision and requires all accepted reports, source parity, IAB evidence and cleanup before branch mutation. No push or deployment has been performed.

The [final inspector](../../.scratch/merge-05-09-17-20261023/inspect-final-evidence.ps1) passed; its [summary](../../.scratch/merge-05-09-17-20261023/verification-summary.json) pins backend gates to `3e48b13` with exact backend parity, and accepted frontend/live/browser gates to the final `dd70d7f` manifest. It verifies required totals and exact file membership/hashes for 611 executable inputs, including all 386 backend inputs. Scratch reports, metadata and attachments are ignored local evidence, not Git-delivered artifacts. The promotion guard rechecks executable parity, all acceptance gates, source-worktree cleanliness and frozen input refs immediately before fast-forward; its manifest and local lifecycle record preserve the actual result.
