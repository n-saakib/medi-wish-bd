# `src/app/(store)/products/[productId]/page.tsx`

Source: [`src/app/(store)/products/[productId]/page.tsx`](<../../../../../../src/app/(store)/products/[productId]/page.tsx>)

## Purpose

Request-rendered public details page for a listable, priced Product.

## Exports and behavior

`resolveProduct()` validates the lower-case UUID before making an anonymous API read. The React-cached loader is shared by the page and `generateMetadata()`, so metadata and body use the same projected Product. Correlated not-found responses render the shared 404 view; other API failures reach the store error boundary. The details view uses the response-bound Product ID for its absolute canonical URL.

## Verification

Ticket 17 browser tests cover Product details server HTML, canonical metadata, gallery interactions, unavailable/malformed resources and upstream failures. They passed in the [2026-10-21 completion verification](<../../../../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
