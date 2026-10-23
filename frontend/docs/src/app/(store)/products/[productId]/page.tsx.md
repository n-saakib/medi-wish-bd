# `src/app/(store)/products/[productId]/page.tsx`

Source: [`src/app/(store)/products/[productId]/page.tsx`](<../../../../../../src/app/(store)/products/[productId]/page.tsx>)

## Purpose

Request-rendered public details page for a listable, priced Product.

## Exports and behavior

`resolveProduct()` validates the lower-case UUID before making an anonymous API read. The React-cached loader is shared by the page and `generateMetadata()`, so metadata and body use the same projected Product. When the Product has an active category, the page renders `CurrentCategoryMark` with `current="true"` for it, so the category bar underlines that category, when it is one of the bar's first eight, without announcing it as the page being viewed (the design's `data-active` on `product.html`). A Product of an inactive category marks nothing. Correlated not-found responses render the shared 404 view; other API failures reach the store error boundary. `generateMetadata()` builds the absolute canonical URL from the response-bound Product ID through `productMetadata()`.

## Verification

Ticket 17 browser tests cover Product details server HTML, canonical metadata, gallery interactions, unavailable/malformed resources and upstream failures. They passed in the [2026-10-21 completion verification](<../../../../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures. The category mark (review round 1) was added on 2026-10-22 and has passed only ESLint, `tsc` and the focused Vitest run (4 files, 63 tests; the `current="true"` mark is covered in `StorefrontComponents.test.tsx`), and its browser assertion is in E2E-17-07. A review round 2 unit case awaits this route with a mocked loader and checks that a Product marks its category's bar link `true` and a Product without a category marks nothing (focused Vitest run: 4 files, 66 tests, 2026-10-22). On 2026-10-22 the working tree on `c9568a6` with the review fixes passed `npm run verify` (42 files, 1,031 units and the production build) and the Ticket 17 Chrome/Edge browser suites (`--grep "@t17"`: 110 passed, 2 demo skips; `@t17-demo` alone: 2 passed); see the [review follow-up](<../../../../../ticket-17-e2e.md#review-follow-up-2026-10-22>).
