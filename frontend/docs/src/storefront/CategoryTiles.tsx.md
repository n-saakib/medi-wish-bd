# `src/storefront/CategoryTiles.tsx`

Source: [`src/storefront/CategoryTiles.tsx`](../../../src/storefront/CategoryTiles.tsx)

Renders responsive, labelled category links with a decorative storefront grid icon. Each tile targets its category page; an empty list produces no grid. The home section caps its input at eight tiles, while `/categories` passes the full list.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers tile labels and destinations. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
