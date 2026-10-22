# `src/storefront/PriceBlock.tsx`

Source: [`src/storefront/PriceBlock.tsx`](../../../src/storefront/PriceBlock.tsx)

Displays the current BDT price, the selling price struck only when a discount applies, a translated percent/amount badge, and a separate unstruck MRP only when it exceeds the current price. The Product card owns the image-overlay badge, so it disables the inline copy here; the details view retains the inline badge. Prior price has a screen-reader label.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers percent/amount badges, struck price and unstruck MRP. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
