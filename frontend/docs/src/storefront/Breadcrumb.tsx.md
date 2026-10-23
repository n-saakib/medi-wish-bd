# `src/storefront/Breadcrumb.tsx`

Source: [`src/storefront/Breadcrumb.tsx`](../../../src/storefront/Breadcrumb.tsx)

## Purpose

Renders the localized breadcrumb shared by the category and Product details pages. The nav carries `breadcrumb storefront-breadcrumb`; the second class scopes the 44 px flex layout in `globals.css` to the storefront so staff breadcrumbs are unaffected.

## Behavior

The navigation landmark uses the translated `storefront.breadcrumb` label and always links Home to `/`. When the Product has a category, it adds that category name linked to its public category page. Products without a category keep the Home-only breadcrumb. The optional `current` prop (`'page'` or `'true'`), passed by the category page, sets that category link's `aria-current`: `page` on page 1, which the link opens, and `true` on later pages, which it does not. The Product page omits it.

## Verification

The mounted storefront tests exercise the breadcrumb links for a category, for a Product without a category, and the `current` mark. The link cases passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures. The `current` prop was added on 2026-10-22 and has passed only the 2026-10-22 focused checks (ESLint, `tsc`, Vitest unit project on `StorefrontComponents`, `SiteHeader`, `storefront` and `storefrontView`: 4 files, 62 tests on `c9568a6`) and a production `next build`. Its change from a boolean to `'page' | 'true'` (review round 1) passed only ESLint, `tsc` and the focused Vitest run (4 files, 63 tests) on 2026-10-22. On 2026-10-22 the working tree on `c9568a6` with the review fixes passed `npm run verify` (42 files, 1,031 units and the production build) and the Ticket 17 Chrome/Edge browser suites (`--grep "@t17"`: 110 passed, 2 demo skips; `@t17-demo` alone: 2 passed); see the [review follow-up](<../../ticket-17-e2e.md#review-follow-up-2026-10-22>).
