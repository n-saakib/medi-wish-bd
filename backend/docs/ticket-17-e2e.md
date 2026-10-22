# Ticket 17 backend acceptance tests

These tests were prepared test-first on 2026-10-17 in `ticket-17-catalog-browse`, at revision `c63359c` with uncommitted test files. They exercise the three anonymous public catalog reads through real HTTP, PostgreSQL and the guarded `medi_wish_test` harness. The production read model, controller and security integration are now present, and the public-read tests have passed against them. The frontend [coverage contract](../../frontend/docs/ticket-17-e2e.md) maps the browser tests.

| Tests | Tags | Observable contract |
| --- | --- | --- |
| `PublicCatalogIT` | `integration`, `security` | T5 steps 1–8 and P16 (see below) |
| `PublicCatalogRegressionIT` | `integration`, `regression`, `security` | T6 steps 1–9 (see below) |
| `PublicCatalogQueriesIT` | `integration` | T7 steps 1–2 (see below) |

**`PublicCatalogIT`**
- `/api/categories` lists categories in `lower(name), id` order. Anonymous, Admin and `Bearer invalid` readers get equal bodies.
- Category pages hold 24 exact cards. Every page form other than a canonical page number in range is the 404 envelope (`-1`, `abc`, empty, `01`, `+1`, `%2B1`, `1.0`, 10 digits, a repeated parameter); `size` is ignored.
- An empty active category has only page 0. Inactive, unknown and malformed categories are 404.
- Details carry ordered images and nullable equipment fields. A Product of an inactive category shows `category: null` and keeps that category's Discount.
- Inactive, unpriced, unknown and malformed Products share one not-found body with the price route.
- Every `price` equals the price route's body without `productId`.
- No response sets a cookie; every response carries `X-Request-ID` and `no-store`.
- Upper-case ids read the same records (P16).

**`PublicCatalogRegressionIT`**
- Deactivation closes the details, listing and price paths; reactivation restores them. A category's deactivation keeps its Products readable.
- Injected markup is returned exactly as stored.
- Responses carry only the exact key sets, with no staff field at any depth.
- Captured logs contain no seeded text, ids or page values.
- A Discount starting tomorrow applies on the first read of the next Asia/Dhaka day, without a restart.
- Reads across repeated deactivation have matching count and page membership and exact `10.00` card price projections: 3 readers and 1 writer, within the Hikari pool of 4. A barrier guarantees reads in both inactive and active states before 18 further reads per reader race with the remaining 9 toggles. Activation is the only changing value in this fixture; it does not prove an atomic price transition.
- After a restart, the bodies are identical.
- Oversized ids and pages are bounded client errors that never echo the value.
- Not applicable, with reasons in the class Javadoc: duplicate, stale and concurrent commands and lost-response replay. The story adds only idempotent `GET`s.

**`PublicCatalogQueriesIT`**
- Prepared-statement counts stay equal for a page of 1 vs 24 discounted, imaged Products, for details with 1 vs 8 images, and for a list of 2 vs 20 categories. Counts print as `T17 SQL counts:`.
- The worst-case page and details payloads stay under 262,144 bytes. Sizes print as `T17 payload bytes:`.

Shared fixture and shape helpers are package-private statics in `PublicCatalogIT`, including a multipart image upload, because `DiscountTestApi` cannot hand its application to `ProductImageTestApi`. Seeded names use a shared token plus mixed-case two-letter codes, so the public order differs from byte order. One equipment Product ties a medicine's lower-cased name, so the id must break the tie.

Current final-candidate verification on 2026-10-21: `t13-backend-final` (`-o -Pcompatibility verify`, PostgreSQL UTF-8 on 55433) passed 999 unit and 348 integration tests with zero failures/errors/skips, including `DependencyCompatibilityIT`. The candidate remains uncommitted at `c63359c` plus working-tree changes; the final source/test hash comparison found no drift. The frontend full suite independently passed 1,164 cases with six demo skips, and its separate Ticket 17 demo passed both browsers. Current ticket evidence: `2026-10-21-final-tree-checks.md` and `2026-10-21-completion.md` in the main checkout.

## Implemented read-model and query coverage

- `PublicCatalogReadIT` (plan T2 step 4) now calls the production `PublicCatalogService` bean directly and passed in the integration run.
- `findMainImages` now fetches position-zero images in one batch. The retained Hibernate report has total prepared-statement counts without a stable per-query statistics key, so `PublicCatalogQueriesIT` intentionally checks constant total cost with imaged, discounted cards rather than a query-key assertion. `PublicCatalogServiceTest` also verifies one batch call for the complete page.

## Targeting during development

Through the plan's `backend.ps1` (which sets the guarded `TEST_DB_*` role on cluster 55433), or directly from `backend` in a process that already has those values:

```powershell
.\mvnw.cmd -o -q test-compile
.\mvnw.cmd -o verify "-Dit.test=PublicCatalogIT" -Dtest=NONE "-Dsurefire.failIfNoSpecifiedTests=false"
.\mvnw.cmd -o verify "-Dit.test=PublicCatalogRegressionIT" -Dtest=NONE "-Dsurefire.failIfNoSpecifiedTests=false"
.\mvnw.cmd -o verify "-Dit.test=PublicCatalogQueriesIT" -Dtest=NONE "-Dsurefire.failIfNoSpecifiedTests=false"
```

Never use port 5432 or `medi_wish_dev`, and never run `mvnw clean` in the main checkout (its `target` holds the test clusters).

## Verification

2026-10-20, `c63359c` plus the uncommitted implementation: the recorded cumulative `backend.ps1 -Port 55433 -Label t8-backend-final-utf8 -MavenArgs '-o verify'` and `backend.ps1 -Port 55433 -Label t11-compat -MavenArgs '-o -Pcompatibility verify'` results passed 999 unit tests and 348 integration tests including compatibility. The public catalog subset passed all 16 integration tests, including the direct service read, HTTP contract, regression, query-cost and payload checks.

`PublicCatalogQueriesIT` recorded page statement counts 5/5 (1/24 cards), details 3/3 (1/8 images), and categories 1/1 (2/20 categories). Payloads were 23,034 bytes for a full page and 7,412 bytes for details, below the 262,144-byte frontend bound. Retained reports are under `backend/target/failsafe-reports/`; these figures describe that run, not a fresh execution for this documentation refresh. Final frontend/browser verification and tracker closure are recorded separately.

Historical preparation: on 2026-10-17 at `c63359c` plus the uncommitted test files, `.\mvnw.cmd -o -q test-compile` exited 0 (Java 25); integration execution was deferred because production routes were absent at that point. The review sections below retain that historical boundary.

## Critical review, 2026-10-17–18

Five rounds reviewed the uncommitted Ticket 17 E2E work at `c63359c84ba1f9f5259e5157ed7703c9a11fee9e`, with GPT-6 Sol High reviewers followed by independent Medium validators. Backend section A had one significant Spec finding fixed in round 1 (exact card prices during the activation race), one fixed in round 2 (guaranteed inactive/active observations), and none in rounds 3–5. No backend Standards finding was substantiated. The frontend [integrated review record](../../frontend/docs/ticket-17-e2e.md#critical-review-2026-10-1718) records all three sections and the final round ledger.

The race still uses three readers, one writer, 20 reads per reader and 10 deactivate/reactivate cycles, with no sleeps. Three inactive and three active reads are coordinated before 18 further reads per reader race with the remaining nine cycles. Every response checks status, count, page membership, uniqueness and exact five-key prices. Those stable observations do not prove an in-flight database interleaving or a price-changing transaction's atomicity. A proposed separate Discount mutation race was rejected as beyond the accepted T6 scenario.

The backend source mirror and index reflect these changes. No production code, migrations or accepted contract changed. Public read integration tests, SQL counts, payload measurements and cumulative API/browser acceptance remain unrun in this review because the new production routes and pages are absent. Compilation and frontend helper/static/probe evidence are recorded separately; they do not close Ticket 17.

### Review verification, 2026-10-18

At `c63359c84ba1f9f5259e5157ed7703c9a11fee9e` plus uncommitted review corrections, `./mvnw.cmd -o -q test-compile` passed with `JAVA_HOME=C:\Program Files\Java\jdk-25.0.4.1` after the final backend test changes. Integration execution remains unrun in this review because the public storefront implementation is absent; compilation does not establish the concurrent-read acceptance contract. See the frontend [review verification](../../frontend/docs/ticket-17-e2e.md#review-verification-2026-10-18) for the 967-unit/build result, initial environment failure, final static checks, 104-test discovery and isolated browser-probe boundaries.

Temporary manifest, reports and probes were removed after recording the review outcomes; final hashes of all 12 test/helper sources matched before cleanup.

## Additional critical review, 2026-10-19

Backend section A completed independent GPT-6 Sol High reviews and Medium validation in additional rounds 6, 7 and 8. Rounds 6 and 7 were clean; Round 8 fixed one significant Spec assertion gap, with no Standards finding: `PublicCatalogIT` now reverses its two images through the existing staff image-order route during shared fixture setup, verifies that order, and expects the public gallery and category card to use the new display order and position-0 image. The source mirror was updated. This is independent of JUnit method order and catches a public implementation that incorrectly uses upload order; Ticket 15 staff-route coverage alone did not establish the public projection. `./mvnw.cmd -o -q test-compile` passed with JDK 25.0.4.1 on 2026-10-19 after the final correction. Runtime public-read integration, query measurements and payload sizes remain unverified because the production public routes are absent. The frontend [additional review ledger](../../frontend/docs/ticket-17-e2e.md#additional-critical-review-2026-10-19) records all section outcomes, narrow frontend assertion fixes, verification boundaries and final cleanup status.

Additional-pass cleanup verified on 2026-10-19: the exact task-owned temporary directory, manifest, 18 reports, probes and snapshots were removed after recording the outcomes. All 12 test/helper source hashes matched before deletion; the original 28-path Git change set was preserved, and final documentation/index parity and whitespace checks passed. No review-created server or database resources remain.
