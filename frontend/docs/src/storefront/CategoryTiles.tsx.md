# `src/storefront/CategoryTiles.tsx`

Source: [`src/storefront/CategoryTiles.tsx`](../../../src/storefront/CategoryTiles.tsx)

Renders responsive, labelled category links with a decorative storefront grid icon. Each tile targets its category page; an empty list produces no grid. The home section caps its input at eight tiles, while `/categories` passes the full list.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers tile labels and destinations. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
