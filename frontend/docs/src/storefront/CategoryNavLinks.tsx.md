# `src/storefront/CategoryNavLinks.tsx`

Source: [`src/storefront/CategoryNavLinks.tsx`](../../../src/storefront/CategoryNavLinks.tsx)

Renders the first eight category destinations and an All categories link in a translated navigation landmark. Empty input produces no navigation. The links remain keyboard-accessible, and the horizontal bar scrolls within its own viewport on narrow screens.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers link count, order, label and destination; browser accessibility checks cover focus and narrow-screen scrolling. Ticket 17 tests have not been run while the baseline browser suite uses `.next`.
