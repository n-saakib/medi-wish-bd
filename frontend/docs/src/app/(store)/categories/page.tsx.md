# `src/app/(store)/categories/page.tsx`

Source: [`src/app/(store)/categories/page.tsx`](<../../../../../src/app/(store)/categories/page.tsx>)

## Purpose

Server-rendered category directory at `/categories`, for visitors who choose See all from the home grid or category bar.

## Exports and behavior

`generateMetadata()` returns translated directory metadata and an absolute `/categories` canonical. `CategoriesPage()` opts into request-time rendering and loads the shared category list together with storefront translations. It renders `CurrentCategoryMark` for `/categories`, so the bar's All categories link is marked current only when this page renders, and every returned category as a link, or a localized empty recovery state when the list is empty. Unlike the home grid and shared header bar, failures in this page's catalog read propagate to the store error boundary. A not-found answer from the list endpoint throws the same way, so it never renders as an empty directory.

## Verification

The Ticket 17 browser page tests (`storefrontPages.spec.ts` and `storefrontOutage.spec.ts`) cover category-directory HTML, links, empty content and outage behavior. The final-tree browser run `t12-browser-clean` passed all 1,164 runnable cases with no failures. A dedicated production-Next regression in `storefrontOutage.spec.ts` now supplies a correlated collection `NOT_FOUND` response and asserts 5xx/retry UI instead of an empty directory. All 10 outage cases, including this regression, passed on Chrome and Edge in the direct worktree run `t15-outage-final` on 2026-10-21. The final run is recorded in the ticket evidence `2026-10-21-final-tree-checks.md`. The `CurrentCategoryMark` was added on 2026-10-22 (review R3-1) and has passed only the 2026-10-22 focused checks (ESLint, `tsc`, Vitest unit project on `StorefrontComponents`, `SiteHeader`, `storefront` and `storefrontView`: 4 files, 62 tests) and a production `next build`; `npm run verify` and the browser suites have not run on it.
