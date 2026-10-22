# `src/app/(store)/not-found.tsx`

Source: [`src/app/(store)/not-found.tsx`](<../../../../src/app/(store)/not-found.tsx>)

## Purpose and behavior

This segment-level route wraps [`NotFoundView`](../../storefront/NotFoundView.tsx.md) in the main landmark. It preserves store chrome and the same translated, resource-neutral 404 content for malformed IDs, unknown or unavailable Products/categories, and out-of-range category pages.

## Verification

Ticket 17 browser tests compare the rendered 404 copy across unavailable and malformed catalog URLs. They passed in the [2026-10-21 completion verification](<../../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
