# `src/storefront/ProductGallery.tsx`

Source: [`src/storefront/ProductGallery.tsx`](../../../src/storefront/ProductGallery.tsx)

Client image gallery for public Product images. The first image is selected initially; 44 px thumbnail buttons expose their selected state with `aria-pressed` and switch the main image by pointer or keyboard. One image needs no thumbnail controls. Empty lists use the shared labelled placeholder. The main image is the details page's Largest Contentful Paint candidate, so it sets `preload` (Next.js 16's replacement for the deprecated `priority`), which preloads it from the document head and loads it eagerly; thumbnails stay lazy.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers selection state, keyboard-operable buttons and the single-image case; browser checks cover rendered details. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
