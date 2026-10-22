# `src/storefront/ProductGallery.tsx`

Source: [`src/storefront/ProductGallery.tsx`](../../../src/storefront/ProductGallery.tsx)

Client image gallery for public Product images. The first image is selected initially; 44 px thumbnail buttons expose their selected state with `aria-pressed` and switch the main image by pointer or keyboard. One image needs no thumbnail controls. Empty lists use the shared labelled placeholder.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers selection state, keyboard-operable buttons and the single-image case; browser checks cover rendered details. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
