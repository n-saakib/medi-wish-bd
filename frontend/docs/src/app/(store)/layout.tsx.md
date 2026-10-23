# `src/app/(store)/layout.tsx`

Source: [`src/app/(store)/layout.tsx`](<../../../../src/app/(store)/layout.tsx>)

## Purpose

Layout for the public store route group. `(store)` is a Next.js route group, so it adds no URL segment; the group contains the home, account, category directory, category listing and Product details routes.

## Export and behavior

`StoreLayout({ children })` opts the group into request-time rendering and places `SiteHeader` and the public category navigation above each page. The category navigation and the page share a `CurrentCategoryProvider`, so only a page that renders (not a store not-found or error view) can mark its bar link as current. The navigation uses the shared React-cached category list and hides on an empty result or read failure. Each route supplies its own main landmark. The root layout owns the session provider, so client-owned signed-in state remains shared with the auth and account flows.

## Verification

Ticket 17 browser tests cover public category navigation and request-time catalog pages; existing header tests cover session-aware store navigation. They passed in the [2026-10-21 completion verification](<../../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures. The `CurrentCategoryProvider` wrapper was added on 2026-10-22 and has passed only the 2026-10-22 focused checks (ESLint, `tsc`, Vitest unit project on `StorefrontComponents`, `SiteHeader`, `storefront` and `storefrontView`: 4 files, 62 tests on `c9568a6`; 63 tests after the review round 1 fixes on 2026-10-22) and a production `next build` on `c9568a6`. On 2026-10-22 the working tree on `c9568a6` with the review fixes passed `npm run verify` (42 files, 1,031 units and the production build) and the Ticket 17 Chrome/Edge browser suites (`--grep "@t17"`: 110 passed, 2 demo skips; `@t17-demo` alone: 2 passed); see the [review follow-up](<../../../ticket-17-e2e.md#review-follow-up-2026-10-22>).
