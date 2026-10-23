# `src/app/(store)/page.tsx`

Source: [`src/app/(store)/page.tsx`](<../../../../src/app/(store)/page.tsx>)

## Purpose

The dynamically rendered public home page. It keeps the sign-out notice and store hero, and adds a compact category grid for browsing the catalog.

## Exports and behavior

`generateMetadata()` waits for a request-time connection and sets `/` as the canonical URL. `HomePage()` also opts into request-time rendering, loads the English `home` messages, and renders the hero with `SignOutNotice` followed by [`HomeCategories`](../../storefront/HomeCategories.tsx.md).

The hero keeps its existing copy: the store name and the `home.description` notice that the online store is being prepared. `HomeCategories` uses the shared React-cached category read, displays up to eight category tiles and a See all link when categories are available, and renders nothing when that shared read fails or returns no categories. This matches the category bar's graceful fallback. The home page has no offers or Most Sold rail.

## Verification

Ticket 17 browser page and outage tests cover the request-time home and category fallback behavior. They passed in the [2026-10-21 completion verification](<../../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
