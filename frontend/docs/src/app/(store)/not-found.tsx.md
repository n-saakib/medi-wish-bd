# `src/app/(store)/not-found.tsx`

Source: [`src/app/(store)/not-found.tsx`](<../../../../src/app/(store)/not-found.tsx>)

## Purpose and behavior

This segment-level route wraps [`NotFoundView`](../../storefront/NotFoundView.tsx.md) in the main landmark. It preserves store chrome and the same translated, resource-neutral 404 content for malformed IDs, unknown or unavailable Products/categories, and out-of-range category pages.

## Verification

Ticket 17 browser tests compare the rendered 404 copy across unavailable and malformed catalog URLs. They were authored but were not run while the baseline browser suite used `.next`.
