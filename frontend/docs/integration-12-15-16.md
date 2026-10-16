# Tickets 12, 15 and 16 integration evidence

Tested source: `91d7e33f5336df669578cce5a2fdbcf93bf5e263`, integration branch `codex/integrate-tickets-12-15-16`, from baseline `7555e2d0654c9ade2edff9d44465553f565b3413`. This record covers saved addresses, Product images and Discounts together; historical per-ticket acceptance does not establish this candidate's combined acceptance. See the [backend integration record](../../backend/docs/integration-12-15-16.md) for backend gates.

## Completed frontend checks

On 2026-10-15 (Asia/Dhaka), `npm run verify` passed ESLint with zero warnings, TypeScript, **948 unit tests across 38 files**, and the production build with **17 application route entries**. Runtime: Node.js **24.18.0**, npm **11.16.0**. The initial runner injected `NEXT_PUBLIC_MEDI_WISH_API_URL=http://127.0.0.1:18115` into the unit gate and caused one existing origin-expectation failure. Removing that runner override restored the accepted default environment; the full verification then passed. No application source or assertion changed to resolve it. Both attempts are retained: [initial log](../../.scratch/merge-12-15-16-20261015/frontend-verify-first.log), [original passing log](../../.scratch/merge-12-15-16-20261015/frontend-verify-initial.log).

Browser discovery listed **1,062 executions across 24 files**, covering installed Chrome and Edge with demonstration scenarios enabled through `MEDI_WISH_DEMO_DIR`. Discovery is an inventory, not executed acceptance. See the [discovery log](../../.scratch/merge-12-15-16-20261015/browser-discovery.log).

After the padded-cell scroll correction below, a fresh `npm run verify` completed at 07:31 Asia/Dhaka on 2026-10-16: lint had zero warnings, type checking passed, all **948 unit tests in 38 files** passed, and the production build passed. The [fresh verification log](../../.scratch/merge-12-15-16-20261015/frontend-verify.log) retains this invocation.

## Combined runtime gates

| Gate | Status |
| --- | --- |
| Live frontend integration and health probe | 2026-10-16 06:30 Asia/Dhaka: all 11 tests across 7 files passed; probe exited 0 with liveness/readiness both `up`. |
| Focused `E2E-16-14` on Chrome and Edge | 2026-10-16 06:32 Asia/Dhaka: 2/2 passed, zero skips, failures or flaky cases. Participating stories: **14, 15, 16**. |
| Full cumulative Chrome/Edge run, demonstrations enabled | Pending. Record actual executed counts, failures, skips and flaky outcomes. |
| Separate `@smoke` run after the full run | Pending. |

The first complete cumulative run on `91d7e33` finished on 2026-10-16 at 07:24 Asia/Dhaka: **1,061 passed, one failed, zero skips or flaky cases** in 52.2 minutes. Edge's 375px Discount layout case scrolled Edit directly and measured viewport ratio `0.9928977489471436`, failing the strict `ratio: 1` assertion. The test now uses the catalog check's existing padded-final-cell scrolling pattern while preserving the full-target assertion; application CSS and behavior are unchanged. The original run is retained under `browser-first/`, including its raw report, API log, runtime identity and `test-results` copy. Paths in that raw report rooted at `frontend/test-results` map to `browser-first/test-results` in the evidence directory. A fresh full run is required after the correction; the first run does not establish acceptance.

The corrected layout scenarios passed **12/12 executions**, three repetitions of each 375px/1280px case in each browser, at 07:27 Asia/Dhaka, with zero skips, failures or flaky outcomes. Command: `frontend.ps1 -Suite browser -Grep 'discount layout at' -Label browser-layout-repeat -RepeatEach 3`. The corresponding runtime metadata explicitly records the uncommitted scroll correction and the spec SHA-256; this focused run does not replace cumulative acceptance.

The extended `E2E-16-14` journey checks that exact image metadata and served bytes survive Discount creation, editing and ending, plus a Product price edit, while verifying the current price contracts. Its [source mirror](tests/browser/discountApi.spec.ts.md) describes the shared image/discount assertions. The focused run used `frontend.ps1 -Suite browser -Grep 'E2E-16-14' -Label browser-e2e-16-14`; the underlying command was `node node_modules/@playwright/test/cli.js test --reporter=line,json --grep E2E-16-14`.

Runtime isolation uses API **18115**, frontend **3115**, and task-owned PostgreSQL **55433**, with disposable roles, schemas and object-storage namespaces. The [runner](../../.scratch/merge-12-15-16-20261015/frontend.ps1) captures the tested revision, unchanged jar SHA-256 and frontend build identity for runtime runs. Logs, raw JSON reports, runtime identities and demo artifacts belong under `.scratch/merge-12-15-16-20261015/`. Final resource-cleanup evidence and the actual runtime results must be added before claiming combined acceptance or merge completion.
