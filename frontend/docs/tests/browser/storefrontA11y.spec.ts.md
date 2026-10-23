# `tests/browser/storefrontA11y.spec.ts`

Source: [`../../../tests/browser/storefrontA11y.spec.ts`](../../../tests/browser/storefrontA11y.spec.ts)

Ticket 17 T7 accessibility and layout checks (plan T7 step 5). A file-level `beforeAll` opens its own Admin `ApiActor` and seeds one synthetic category of 25 Products, so the category has two pages. It uploads a PNG and a JPEG to the first Product for the gallery checks. The narrow layout test adds two long, listable synthetic categories so a standalone run forces bar overflow. Every test has the tags `@t17`, `@t17-T7` and `@t17-ui`, and each runs in `chrome` and `msedge`.

| Test id | What it proves |
| --- | --- |
| E2E-17-19 Tab order | From the top of category page 1, Tab reaches every `Categories` bar link in DOM order, then all 24 cards in grid order, then **Next**. On page 2 the order ends with **Previous**. Every focused bar, card and pager element has the designed solid, at least 3 px amber outline; for bar links the ring (outline width plus offset) must also fit vertically inside the padding box (`clientTop`/`clientHeight`) of the horizontally scrolling `.catnav-links`, which would otherwise clip it. The ring is not checked horizontally: focus scrolling aligns the link's border box, not its outline, so a link at the scroll edge would fail without a real defect. |
| E2E-17-19 landmarks | On `/`, `/categories`, the category page and the details page there is exactly one `h1`, the `Categories` nav, and a non-empty `alt` on every `img`. The category page has the `Pagination` nav and the details page has the `Breadcrumb` nav. |
| E2E-17-19 gallery | The thumbnails expose `aria-pressed`. Enter on `Image 2` and then Space on `Image 1` each select that thumbnail and swap the large `.gallery-main img` to that image's id. |
| E2E-17-19 targets | Every visible link and button is at least 44 px tall, in the bar and the home Categories section on `/`, and in the bar and `main` on `/categories`, both category pages and the details page. |
| E2E-17-20 narrow / wide | At 375×812 and 1280×800, on the four pages, `scrollWidth <= innerWidth`, and no element other than `.catnav .container` may scroll horizontally. At 375, the bar itself has `overflow-x: auto/scroll`, overflows, moves when scrolled, and reveals its last link. The first row of the product grid has exactly 2 distinct card x positions at 375 and at least 4 at 1280. |

Targeting: `--grep @t17-T7`, `--grep "E2E-17-19"`, `--grep "E2E-17-20 narrow"`.

Local helpers: `focused`, `tabUntilPager`, `expectStorefrontOrder` and `expectTallTargets`. The height check is local because `discountSupport.expectLabelledTargets` scans the whole page and also requires a 44 px width.

Written test-first before the storefront UI existed. The implementation is now present; the Ticket 17 E2E report records browser execution and the current cumulative verification boundary.

On 2026-10-23 (`73eeaa9` plus working tree) the change (bar focus-ring containment in E2E-17-19 Tab order) passed ESLint and `tsc --noEmit`, then ran with `TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55433` (PostgreSQL 18 UTF8) and a jar rebuilt from that tree: `npx playwright test tests/browser/storefrontRegression.spec.ts tests/browser/storefrontA11y.spec.ts --grep "E2E-17-1[69]"` passed 14 of 14 (7 per Chrome and Edge project); no browser roles or schemas were left and ports 18115 and 3115 were freed.
