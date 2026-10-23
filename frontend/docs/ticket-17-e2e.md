# Ticket 17 E2E development contract

Test-first preparation on 2026-10-17 in `ticket-17-catalog-browse`, at revision `c63359c` with uncommitted test files. These tests were written before any Ticket 17 production code, from the implementation plan (`.scratch/launch-reconciliation/ticket-drafts/17 - Browse categories and server-rendered Product details/17-implementation-plan.md` in the main checkout's ignored planning folder; §4.0.1 API, §4.0.5 pages, T5–T8). The public catalog routes and server-rendered storefront are implemented. Current verification status is in [Review follow-up, 2026-10-22](#review-follow-up-2026-10-22): on 2026-10-22, `npm run verify` and the Ticket 17 Chrome/Edge suites passed with the review fixes; the cumulative all-story browser suite, integration and probe last passed on `c63359c` plus the 2026-10-21 working tree. The dated preparation and review sections preserve their historical boundaries. A failing pre-implementation baseline is not a defect in the tests.

E2E-17-06 compares each seeded Product's public API image order and first category-card image directly with the same values extracted from JavaScript-disabled server-rendered HTML.

## Completion verification, 2026-10-21

The storefront and anonymous public API are implemented. On `c63359c` plus the frozen uncommitted working tree, direct verification passed 999 backend units and 348 integration tests with compatibility enabled, and frontend verification passed lint, typecheck, 1,024 units in 42 files and the production build. The clean full Chrome/Edge run (`t12-browser-clean`) passed 1,164 cases with six documented demo skips, zero failures and zero flaky cases. The separate Ticket 17 demo passed both browsers; real-client integration passed 12 tests and the health probe reported liveness/readiness up.

The production-Next regression in `storefrontOutage.spec.ts` supplies a correlated category-collection `NOT_FOUND` response and checks HTTP 5xx, retry UI, an actual API read, and absence of empty/not-found content or internal details. All 10 outage cases passed directly in `t15-outage-final` and in the later complete suite. The isolated build-output snapshot independently passed the same full suite, the separate demo and integration/probe (`t16-final`); only four test-port literals differ in that copy. All 496 original source/test hashes still match its captured candidate manifest after both sessions finished.

Current commands, build identities, results, retained failed/interrupted runs and cleanup evidence are in the main checkout's ignored ticket evidence `evidence/2026-10-21-final-tree-checks.md` and `evidence/2026-10-21-completion.md`. On 2026-10-21, T1–T8 were done. The 2026-10-22 review changes below reopened T8's verification gate; `npm run verify` and the Ticket 17 Chrome/Edge suites have since passed on them, while the cumulative all-story browser suite, real-client integration and the probe have not rerun. Parent Ticket 17 remains in progress solely under plan section 9's gate requiring Tickets 15 and 16 to be done. The original home description and development loopback site-origin fallback remain accepted choices. Historical preparation and review sections below retain their dated verification boundaries.

## Review follow-up, 2026-10-22

Commit `c9568a6` changed behavior after the 2026-10-21 completion run: the product-neutral review-note copy, the page-declared category-bar mark (`CurrentCategoryProvider` / `CurrentCategoryMark`), the breadcrumb's `aria-current`, the store header on the root not-found page, and CSS. The review round 1 fixes committed after it add `aria-current="true"` for later listing pages and a Product's category (page 1 and `/categories` keep `page`), mark the Product's category in the bar on details pages (with `aria-current="true"`, as `ui-design/product.html` underlines it), add the E2E-17-07 current-mark browser case, and correct documentation. The round 2 fixes add unit cases that render the category and Product routes with mocked loaders and check the bar and breadcrumb marks they declare, plus a mark-swap case, and drop E2E-17-07's page-2 bar check, which usually could not fail, because the fixture category usually sorts after the bar's first eight.

- **Ran on `c9568a6`:** ESLint, `tsc`, focused Vitest (`StorefrontComponents`, `SiteHeader`, `storefront`, `storefrontView`: 4 files, 62 tests) and a production `next build`; `playwright test --list --grep "@t17"` listed 110 tests.
- **Ran on the working tree on `c9568a6` with the round 1 fixes (2026-10-22):** `npx tsc --noEmit` clean; `npm run lint` clean; `npx vitest run --project unit` on the four files above: 4 files, 63 tests passed; on `StorefrontComponents`, `storefront`, `storefrontView`, `storefrontSupport` and `ProductImage`: 5 files, 82 tests passed; `npx playwright test --list --grep "@t17"`: 112 tests in 7 files.
- **Ran on the working tree on `c9568a6` with the round 2 fixes (2026-10-22):** `npx tsc --noEmit` clean; `npm run lint` clean; the same four-file Vitest run: 4 files, 66 tests passed; the five-file run: 5 files, 85 tests passed; `npx playwright test --list --grep "@t17"`: 112 tests in 7 files; `git diff --check` clean.
- **Ran on the working tree on `c9568a6` after review rounds 1–4 (2026-10-22, cluster 55433, evidence `.scratch/ticket-17-runs/t18-*` in the main checkout):**
  - `npm run verify` (`TEST_DB_HOST=127.0.0.1`, `TEST_DB_PORT=55433`, `VITEST_MAX_WORKERS=1`): exit 0; lint and typecheck clean, 42 files / 1,031 unit tests passed, production build compiled (`t18-npm-verify.log`).
  - `browser.ps1 -Grep "@t17" -Label t18-browser-t17`: exit 0, 110 passed and 2 skipped (the demo cases, which run only with the demo directory) of 112 on Chrome and Edge in 3.4 minutes, finished 12:14 +06:00; jar SHA-256 `A20AE19C…1FCE68`, build ID `6amDhfp-_8qsrm8zop-9i`. This includes the E2E-17-07 current-mark and E2E-17-09 unmatched-URL cases and the `reviewNote` assertions with the product-neutral copy. The web server printed `The destination stream closed early` for aborted streamed responses, as it did in the 2026-10-21 clean run; no test failed on it.
  - `browser.ps1 -Demo -Grep "@t17-demo" -Label t18-demo`: exit 0, 2 passed (Chrome and Edge), finished 12:16 +06:00.
- **Committed revision:** review rounds 3 and 4 are not itemized here, but every code and test file in the next commit, `1614ec4` (*Mark the current category on later pages and Product details*, 12:18 +06:00), was last modified by 10:55 +06:00, before these runs. File times indicate that this commit is the verified working tree, with only documentation changed between the runs and the commit; no hash or manifest of the tested tree was recorded.
- **Added after the 2026-10-22 runs (2026-10-23):** E2E-17-07's Product step also asserts that the breadcrumb shows Home and the category, and that no breadcrumb link has `aria-current`. On 2026-10-23 the working tree on `1614ec4` with these assertions passed `browser.ps1 -Grep "E2E-17-07" -Label t19-e2e-17-07`: exit 0, 4 passed (both E2E-17-07 cases on Chrome and Edge) in 2.1 minutes, finished 07:04 +06:00; jar SHA-256 `DB18A25A…B2690D`, build ID `01OKll6nprpV3-HsHDInK` (evidence `.scratch/ticket-17-runs/t19-e2e-17-07*` in the main checkout). The rest of the Ticket 17 suite was not rerun with them.
- **Not rerun on these changes:** the cumulative all-story browser suite (1,168 cases), `npm run test:integration` and `npm run probe`, and the backend suites (no backend code changed after 2026-10-21).

Design deviations recorded here because the ticket drafts are ignored planning files:

- **Review-note copy (owner decision, 2026-10-22).** The note reads "Our team reviews this product before dispatch…" instead of the design's and plan's "…reviews this medicine…", because `requireValidation` also applies to Equipment. The repository owner chose the product-neutral copy on 2026-10-22; the ticket drafts and `ui-design/product.html` still show the old wording.
- **Client-only current mark.** The bar's `is-active`/`aria-current` mark is set after hydration, so server HTML and JavaScript-disabled readers show no current category, while the design renders it in markup. The layout cannot know whether the page will answer 404, and a server-side mark would mark a category on its own 404 page. Accepted trade-off.

## Accepted behavior under test

- **API.** `GET /api/categories` lists active categories that have at least one active priced Product, ordered by `lower(name), id`.
  - `GET /api/categories/{id}/products?page=n` returns 24 cards per 0-based page.
  - `GET /api/products/{id}` returns the public details.
  - Every response is anonymous, `no-store`, correlated, cookie-free and carries only whitelisted fields.
  - Inactive, unknown, malformed, unpriced and past-the-end cases share one `404 NOT_FOUND` body. An empty active category's page 0 is `200 []`.
  - A Product of an inactive category stays readable with `category: null`, and its Discount still applies.
  - The API accepts any UUID case (P16).
- **Pages.** The pages are server-rendered without client JavaScript:
  - `/` adds a Categories grid (first 8, "See all").
  - `/categories` shows every listable category.
  - `/categories/{id}?page=n` is 1-based; `?page=1` redirects 307 to the bare URL, and invalid pages are 404.
  - `/products/{id}` shows the gallery, price block, About rows and the review note.
  - Only lower-case UUIDs are accepted in page URLs.
  - Every page has its title, meta description and absolute canonical link.
  - One not-found page covers every unpurchasable case. Unmatched URLs answer 404 from the root not-found page, which keeps the store header's Logo link home. An API outage gives a 5xx error page, and the home page still works without the bar.
- **Never shown.** No purchase control, stock wording, filter, sort, staff field, scheduled Discount or executed injected markup ever appears.

## Files

| File | Ids | Tags |
| --- | --- | --- |
| [storefrontSupport.ts](tests/browser/storefrontSupport.ts.md) and its [unit test](tests/storefrontSupport.test.ts.md) | Shared contract, guards, fixtures, locators | Unit project |
| [storefrontApi.spec.ts](tests/browser/storefrontApi.spec.ts.md) | E2E-17-01…04 | `@t17 @t17-T5 @t17-api` |
| [storefrontPages.spec.ts](tests/browser/storefrontPages.spec.ts.md) | E2E-17-05…11 | `@t17 @t17-T5 @t17-ui` |
| [storefrontRegression.spec.ts](tests/browser/storefrontRegression.spec.ts.md) | E2E-17-12…17 | `@t17 @t17-T6 @t17-ui @regression` |
| [storefrontSmoke.spec.ts](tests/browser/storefrontSmoke.spec.ts.md) | E2E-17-18 | `@t17 @t17-T7 @t17-ui @smoke` |
| [storefrontA11y.spec.ts](tests/browser/storefrontA11y.spec.ts.md) | E2E-17-19, 20 | `@t17 @t17-T7 @t17-ui` |
| [storefrontOutage.spec.ts](tests/browser/storefrontOutage.spec.ts.md) | E2E-17-21 (second `next start` on port 3116) | `@t17 @t17-T6 @t17-ui @regression` |
| [storefrontDemo.spec.ts](tests/browser/storefrontDemo.spec.ts.md) | E2E-17-22 (skipped unless `MEDI_WISH_DEMO_DIR` is set) | `@t17 @t17-demo` |

The fixture-free frontend adapter integration is [storefront.integration.test.ts](tests/storefront.integration.test.ts.md). It uses `MEDI_WISH_API_URL` with the production storefront client to verify a valid category projection and correlated not-found mapping for unknown and malformed reads. The browser harness starts the isolated API for this integration project.

Cross-story tags mark tests that cross an earlier story's contract:

| Tag | Tests |
| --- | --- |
| `@cross-03-17` | E2E-17-11 |
| `@cross-14-17` | E2E-17-15 |
| `@cross-15-17` | E2E-17-03 and 06 |
| `@cross-16-17` | E2E-17-04, 10 and 17 |

Each E2E id is split into focused tests whose titles all start with the id, so `--grep "E2E-17-08"` selects one behavior. 56 tests per browser project (112 across `chrome` and `msedge`). This includes the home canonical case and the correlated category-list NOT_FOUND regression added on 2026-10-21, and the E2E-17-09 unmatched-URL and E2E-17-07 category-bar current-mark cases added on 2026-10-22, which passed on Chrome and Edge on 2026-10-22. Backend coverage is in [the backend report](../../backend/docs/ticket-17-e2e.md).

## Targeting during development

From the worktree's `frontend`, with the harness environment described in plan §2.6:
- cluster 55433 running;
- `TEST_DB_HOST=127.0.0.1`, `TEST_DB_PORT=55433`, `TEST_DB_ADMIN=postgres` and `PSQL` set in the same process;
- a fresh `backend\target\medi-wish.jar`;
- ports 18115, 3115 and 3116 free.

| Work in progress | Command |
| --- | --- |
| Helpers only | `npx vitest run --project unit tests/storefrontSupport.test.ts` |
| T5 real API client | `browser.ps1 -Suite integration -Label t5-integration` |
| T2/T4 API (no pages needed) | `npm run test:browser -- --project chrome --grep "@t17-api"` |
| One behavior | `npm run test:browser -- --project chrome --grep "E2E-17-02"` |
| T3 pages | `npm run test:browser -- --project chrome --grep "@t17-ui"` |
| Plan task gates | `--grep "@t17-T5"`, `"@t17-T6"`, `"@t17-T7"` |
| Smoke and outage | `--grep "@smoke"`; `--grep "E2E-17-21"` (needs port 3116) |
| Cross-story checks | `--grep "@cross-16-17"` and the other cross tags |
| Demo | set `MEDI_WISH_DEMO_DIR`, then `--grep "@t17-demo"` |
| Whole story, both browsers | `npm run test:browser -- --grep "@t17"` |

`npm run test:browser -- --list --grep "@t17"` shows the selection without running it.

## Deliberate choices

- **Card name links.** The 44 px check (E2E-17-19) includes card name links. The plan's CSS list (§4.0.5) gives 44 px rules only to buttons, bar links, thumbnails, breadcrumb links and tiles, so T3 must also give `.product-card .name a` a 44 px minimum height. That follows the repository rule that every target is 44 px.
- **Apostrophes.** The not-found and error copy is matched with either `'` or `’`; the repository's messages use `’`.
- **Category heading.** The heading must contain the category name. The product count may be anywhere in `main`.
- **Header-bar checks.** The bar is compared with the first 8 names of `GET /api/categories`, read just before. Other suites create categories in the same schema, so no test asserts the whole list.
- **Staff fields in HTML.** E2E-17-16 matches `"version"` and `"status"` as JSON keys, because `role="status"` is a legitimate attribute.
- **Ordering.** Names are a shared prefix plus a two-letter code whose first letter alternates case, so the public `lower(name)` order differs from byte order under any collation.

## Verification

2026-10-17, `c63359c` plus the uncommitted test files:

- **Static checks.** `npx tsc --noEmit -p .` and `npx eslint --max-warnings 0` on the new files: clean. `npx vitest run --project unit tests/storefrontSupport.test.ts`: 19 passed. `npx playwright test --list --grep "@t17"`: 104 tests in 7 files.
- **Test-first run.** On Chrome only, against the real jar built from this revision, PostgreSQL 18 UTF8 on 55433 and a fresh Next build: `--project chrome --grep "@t17"` gave 46 failed, 1 skipped (the demo, without `MEDI_WISH_DEMO_DIR`) and 5 did not run (serial describes stop after their first failure).
  - Every failure comes after its fixtures were created through the real staff routes, so the seeding helpers work.
  - Each failure is at the first missing feature: `401` from the not-yet-public `/api/categories…` and `/api/products/{id}` routes; `404` for `/categories…` and `/products/…`; `404` instead of `307` for `?page=1`; `404` instead of `≥ 500` on the outage server, which started on port 3116 and stopped cleanly.
- **Harness fix.** Three tests first hung for 120 s, because `serverHtml` waited for a `main` element that the framework 404 lacks. After the fix, a re-run of those three failed immediately on `Expected: 200, Received: 404`.
- **Cleanup.** No browser roles or schemas were left behind; ports 18115, 3115 and 3116 are free; the 55433 cluster this task started was stopped.

These results show only that the tests are wired correctly and fail for the right reason. They do not show that the feature works.

## Critical review, 2026-10-17–18

Reviewed the existing uncommitted Ticket 17 E2E work at `c63359c84ba1f9f5259e5157ed7703c9a11fee9e` in `ticket-17-catalog-browse`. A temporary manifest divided it into three independent sections: A backend HTTP/regression/query acceptance, B browser API/fixtures/regression, and C server-rendered pages/accessibility/outage/smoke/demo. Every round used GPT-6 Sol High reviewers followed by separate GPT-6 Sol Medium validators/fixers. Later rounds redeployed those role-specific agents when the agent-thread creation limit was reached. Usage-limit interruptions resumed from saved reports and were not counted as completed reviews.

| Round | Significant Standards findings fixed | Significant Spec findings fixed |
| --- | ---: | ---: |
| 1 | 1 | 4 |
| 2 | 0 | 2 |
| 3 | 0 | 1 |
| 4 | 0 | 0 |
| 5 | 0 | 2 |

All five rounds completed. The two-consecutive-clean-round stop rule did not trigger: round 5 found two necessary assertion gaps. No significant validated finding remains open within this review scope; runtime feature acceptance remains pending.

- **Backend acceptance:** every card read during the activation race now has its exact price projection checked. Barrier phases guarantee observations of both inactive and active states before the remaining stress reads. This does not guarantee a read at the exact instant of a database update or prove a separate price-changing transaction is atomic.
- **API and privacy:** the shared 404 guard rejects malformed or overlong matching request IDs. Privacy fixtures now record generated Product names and generated category names, and the log assertion runs last so it includes the scheduled-Discount fixture.
- **Pages and accessibility:** keyboard traversal requires the documented amber focus ring; the MRP label and its ancestors cannot be struck; gallery thumbnail image/alt pairs must preserve order and multiplicity; every card destination matches its Product id; and the About description preserves visible line breaks as well as raw text.
- **Rejected proposals:** a separate Category Discount transition race exceeded the prescribed activation scenario. The claimed repeat-run header-category accumulation was invalid because successful tests deactivate their own category. Remembered unique Product-name prefixes already detect the corresponding full-name leaks; redundant full-name tracking was not added where a prefix suffices.

The matching source mirrors were updated. Production routes/pages, implementation plans and story completion status were not changed; all edits remain uncommitted. Temporary reports and probes are removed after their outcome and verification are recorded here. The backend [acceptance record](../../backend/docs/ticket-17-e2e.md) preserves the backend-specific limits.

### Review verification, 2026-10-18

Revision: `c63359c84ba1f9f5259e5157ed7703c9a11fee9e` plus the uncommitted Ticket 17 tests and review corrections.

- `npm run verify` with `TEST_DB_HOST=127.0.0.1` and `TEST_DB_PORT=55433`: lint, TypeScript, 967 unit tests across 39 files, and the production Next build passed during review. An earlier invocation without those environment variables failed six mocked address-support tests (961 passed); the configured rerun passed. These mocked unit tests did not start PostgreSQL.
- `npx vitest run --project unit tests/storefrontSupport.test.ts`: 19 passed, including malformed and overlong request-ID rejection.
- After the final round's browser assertion changes: `npx eslint --max-warnings 0 tests/browser/storefrontPages.spec.ts tests/browser/storefrontRegression.spec.ts`, `npx tsc --noEmit --incremental false`, and `npx playwright test --list --grep '@t17'`: passed; 104 tests discovered in seven files. The full unit/build command above preceded those final E2E-only assertion changes.
- Backend: `./mvnw.cmd -o -q test-compile` with JDK 25.0.4.1 passed after the final backend corrections.
- Installed-Chrome synthetic probes confirmed the revised focus, MRP and gallery assertions reject broken fixtures, and confirmed visible description newline and all-card destination checks distinguish the targeted failures. These probes exercised isolated fixtures, not the production storefront.

The feature integration and full browser suites were not rerun as acceptance gates in this review: the public storefront routes/pages are still absent. Earlier test-first failures above remain the runtime evidence; passing compilation, discovery and synthetic probes do not establish story acceptance. No application server or database was started for these review checks.

Cleanup verified on 2026-10-18: the exact task-owned temporary directory containing the manifest, 30 review reports, probes and snapshots was removed after recording these outcomes; final hashes of all 12 test/helper sources matched before removal. No review-created application/database resources remain.

## Additional critical review, 2026-10-19

Continued the same three independent sections at `c63359c84ba1f9f5259e5157ed7703c9a11fee9e` plus the preserved uncommitted Ticket 17 tests. Each additional round uses GPT-6 Sol High review followed by separate GPT-6 Sol Medium skeptical validation and necessary fixes. The initial Round 6 usage-limit interruption was resumed and did not count as a completed review. A temporary manifest, snapshots and 18 per-section reports recorded the additional pass.

| Round | Significant Standards findings fixed | Significant Spec findings fixed | Status |
| --- | ---: | ---: | --- |
| 6 | 0 | 4 | Complete |
| 7 | 0 | 0 | Complete |
| 8 | 0 | 1 | Complete |

Round 6 fixed four necessary assertion gaps: E2E-17-14 rejects purchase links by accessible name and cart/checkout destination, including icon-only links; E2E-17-13 compares visible body text, page title and meta description across the not-found cases; E2E-17-05 checks the home page's absolute canonical in server HTML; and E2E-17-20 seeds two additional long listable categories and requires the narrow bar to overflow, move horizontally and reveal its last link on all four storefront pages. Three browser source files and their mirrors changed in Round 6. Round 8 also corrected the backend fixture: its two images are reversed through the staff API before public reads, so the details gallery and category card must follow current `display_order` rather than upload order. The matching backend source mirror changed; shared helpers remained unchanged.

Validators rejected an exhaustive permitted-link inventory, equal 404 canonicals, forced wide-screen bar overflow, and fixture extraction as unnecessary. These checks do not add production behavior or alter the accepted contract. All three additional rounds completed. Round 7 was independently clean across all sections, but Round 8 found the necessary image-order assertion gap, so the two-consecutive-clean-round stop condition did not trigger. Five significant Spec findings were fixed; no significant Standards finding was substantiated, and no validated finding remains open within this test-review scope.

### Additional-pass verification

On 2026-10-19 at the revision above plus the uncommitted review corrections:

- `node node_modules/vitest/vitest.mjs run --project unit tests/storefrontSupport.test.ts`: 19 passed on the starting candidate; that helper and its unit source remained unchanged.
- Backend `./mvnw.cmd -o -q test-compile`, with `JAVA_HOME=C:\Program Files\Java\jdk-25.0.4.1`: passed initially and again after the final Round 8 image-order correction.
- After Round 6 fixes, `node node_modules/eslint/bin/eslint.js --max-warnings 0 tests/browser/storefrontPages.spec.ts tests/browser/storefrontA11y.spec.ts tests/browser/storefrontRegression.spec.ts` and `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- `node node_modules/playwright/cli.js test --list --grep '@t17'`: 106 tests in seven files. The previous 104-test results above are historical verification before the added home case.
- Isolated Chrome fixtures confirmed that the prior purchase-control checks accepted an icon-only cart link and that a leaked title bypassed the prior main-text comparison; the revised predicates detect both. A separate synthetic Chrome probe accepted a working scrolling bar and rejected wrapped non-scrolling content. These probes did not exercise a production storefront.

The first direct `npx` attempt could not run because `npx` is absent from this session's PATH; direct Node/local binaries were used successfully. The first sandboxed Vitest launch was denied cache-file access in the worktree, and the authorized rerun passed. Full feature E2E/integration acceptance remains unrun because the storefront implementation is absent; no application server or database was started during this additional review. The earlier 967-unit/build result remains historical and was not rerun for these E2E-only edits. All changes remain uncommitted.

Additional-pass cleanup verified on 2026-10-19: the exact task-owned temporary directory, manifest, 18 reports, probes and snapshots were removed after recording the outcomes. All 12 test/helper source hashes matched before deletion; the original 28-path Git change set was preserved, and final documentation/index parity and whitespace checks passed. No review-created server or database resources remain.
