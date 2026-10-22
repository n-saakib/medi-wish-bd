# `src/app/(store)/page.tsx`

Source: [`src/app/(store)/page.tsx`](<../../../../src/app/(store)/page.tsx>)

## Purpose

The dynamically rendered public home page. It keeps the sign-out notice and store hero, and adds a compact category grid for browsing the catalog.

## Exports and behavior

`generateMetadata()` waits for a request-time connection and sets `/` as the canonical URL. `HomePage()` also opts into request-time rendering, loads the English `home` messages, and renders the hero with `SignOutNotice` followed by [`HomeCategories`](../../storefront/HomeCategories.tsx.md).

The hero keeps the store name and describes browsing medicines and health products by category. `HomeCategories` uses the shared React-cached category read, displays up to eight category tiles and a See all link when categories are available, and renders nothing when that shared read fails or returns no categories. This matches the category bar's graceful fallback. The home page has no offers or Most Sold rail.

## Verification

Ticket 17 browser page and outage tests cover the request-time home and category fallback behavior. They were authored but not run while the baseline browser suite was using the existing `.next` output.
