# `src/app/(store)/categories/[categoryId]/page.tsx`

Source: [`src/app/(store)/categories/[categoryId]/page.tsx`](<../../../../../../src/app/(store)/categories/[categoryId]/page.tsx>)

## Purpose

Request-rendered public Product listing for one category, with a stable visible page number over the API's zero-based page parameter.

## Exports and behavior

`CategoryPageProps` models Next's asynchronous route and query inputs. `generateMetadata()` and `CategoryPage()` share `resolvePage()` and the request-cached read. It rejects malformed lower-case UUIDs before redirecting `?page=1`, rejects malformed or repeated page values, requests 24 Products per API page, and turns a correlated public not-found into the shared 404 view. The page renders `CurrentCategoryMark` for its category, so the bar marks that category only when the listing renders (a 404 on the same URL marks none), a category breadcrumb whose category link is marked as the current page, name/count, Product cards or the empty state, and previous/next links. Metadata uses a canonical URL for the current visible page; API failures other than not-found reach the generic error boundary.

## Verification

Ticket 17 browser tests cover server HTML, page-two canonical/link behavior, out-of-range and malformed URLs, empty categories and outage handling. They passed in the [2026-10-21 completion verification](<../../../../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures. Passing `current` to the breadcrumb and rendering `CurrentCategoryMark` (review R3-1) were added on 2026-10-22 and have passed only the 2026-10-22 focused checks (ESLint, `tsc`, Vitest unit project on `StorefrontComponents`, `SiteHeader`, `storefront` and `storefrontView`: 4 files, 62 tests) and a production `next build`; `npm run verify` and the browser suites have not run on them.
