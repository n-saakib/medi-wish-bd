# `src/app/(store)/categories/[categoryId]/page.tsx`

Source: [`src/app/(store)/categories/[categoryId]/page.tsx`](<../../../../../../src/app/(store)/categories/[categoryId]/page.tsx>)

## Purpose

Request-rendered public Product listing for one category, with a stable visible page number over the API's zero-based page parameter.

## Exports and behavior

`CategoryPageProps` models Next's asynchronous route and query inputs. `generateMetadata()` and `CategoryPage()` share `resolvePage()` and the request-cached read. It rejects malformed lower-case UUIDs before redirecting `?page=1`, rejects malformed or repeated page values, requests 24 Products per API page, and turns a correlated public not-found into the shared 404 view. The page renders `CurrentCategoryMark` for its category (a 404 on the same URL marks none) and a category breadcrumb. Both mark the category with `aria-current="page"` on page 1 and `aria-current="true"` on later pages, since the category link opens page 1. It also renders the name/count, Product cards or the empty state, and previous/next links. Metadata uses a canonical URL for the current visible page; API failures other than not-found reach the generic error boundary.

## Verification

Ticket 17 browser tests cover server HTML, page-two canonical/link behavior, out-of-range and malformed URLs, empty categories and outage handling. They passed in the [2026-10-21 completion verification](<../../../../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures. Passing `current` to the breadcrumb and rendering `CurrentCategoryMark` (review R3-1) were added on 2026-10-22 and have passed only the 2026-10-22 focused checks (ESLint, `tsc`, Vitest unit project on `StorefrontComponents`, `SiteHeader`, `storefront` and `storefrontView`: 4 files, 62 tests on `c9568a6`) and a production `next build`. The page-dependent `current` value (review round 1, M6) passed only ESLint, `tsc` and the focused Vitest run (4 files, 63 tests) on 2026-10-22, and its browser case is in E2E-17-07. A review round 2 unit case in `StorefrontComponents.test.tsx` awaits this route with mocked loaders and checks that page 1 marks the bar and breadcrumb links `page` and page 2 marks them `true` (focused Vitest run: 4 files, 66 tests, 2026-10-22). On 2026-10-22 the working tree on `c9568a6` with the review fixes passed `npm run verify` (42 files, 1,031 units and the production build) and the Ticket 17 Chrome/Edge browser suites (`--grep "@t17"`: 110 passed, 2 demo skips; `@t17-demo` alone: 2 passed); see the [review follow-up](<../../../../ticket-17-e2e.md#review-follow-up-2026-10-22>).
