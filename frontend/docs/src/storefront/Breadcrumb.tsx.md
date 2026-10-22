# `src/storefront/Breadcrumb.tsx`

Source: [`src/storefront/Breadcrumb.tsx`](../../../src/storefront/Breadcrumb.tsx)

## Purpose

Renders the localized breadcrumb shared by the category and Product details pages.

## Behavior

The navigation landmark uses the translated `storefront.breadcrumb` label and always links Home to `/`. When the Product has a category, it adds that category name linked to its public category page. Products without a category keep the Home-only breadcrumb. The optional `current` prop, passed by the category page, marks that category link `aria-current="page"` because it is the page being viewed; the Product page omits it.

## Verification

The mounted storefront tests exercise the breadcrumb links for a category, for a Product without a category, and the `current` mark. The link cases passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures. The `current` prop was added on 2026-10-22 and has passed only the 2026-10-22 focused checks (ESLint, `tsc`, Vitest unit project on `StorefrontComponents`, `SiteHeader`, `storefront` and `storefrontView`: 4 files, 61 tests) and a production `next build`; `npm run verify` and the browser suites have not run on it.
