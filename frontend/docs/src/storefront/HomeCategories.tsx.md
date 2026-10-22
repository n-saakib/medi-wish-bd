# `src/storefront/HomeCategories.tsx`

Source: [`src/storefront/HomeCategories.tsx`](../../../src/storefront/HomeCategories.tsx)

Request-time home section backed by the same React-cached category read as the category bar. It shows up to eight links and a See all destination when categories are available, and hides the entire section when the list is empty or unavailable under accepted P10 behavior. It adds no offer or Most Sold content.

Verification: Ticket 17 browser page and outage tests cover the rendered section and its graceful failure behavior. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
