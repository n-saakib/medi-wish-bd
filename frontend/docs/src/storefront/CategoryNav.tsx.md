# `src/storefront/CategoryNav.tsx`

Source: [`src/storefront/CategoryNav.tsx`](../../../src/storefront/CategoryNav.tsx)

## Purpose and behavior

Request-time server component mounted below the storefront header. It uses the shared React-cached category loader and returns nothing when the list is empty or unavailable, as required by P10. Available categories are rendered by [`CategoryNavLinks`](CategoryNavLinks.tsx.md).

## Verification

Mounted tests cover the named navigation landmark, first eight category links and the All categories destination. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
