# `src/app/(store)/products/[productId]/page.tsx`

Source: [`src/app/(store)/products/[productId]/page.tsx`](<../../../../../../src/app/(store)/products/[productId]/page.tsx>)

## Purpose

Request-rendered public details page for a listable, priced Product.

## Exports and behavior

`resolveProduct()` validates the lower-case UUID before making an anonymous API read. The React-cached loader is shared by the page and `generateMetadata()`, so metadata and body use the same projected Product. Correlated not-found responses render the shared 404 view; other API failures reach the store error boundary. The details view uses the response-bound Product ID for its absolute canonical URL.

## Verification

Ticket 17 browser tests cover Product details server HTML, canonical metadata, gallery interactions, unavailable/malformed resources and upstream failures. They are authored but were not run while the baseline browser suite used `.next`.
