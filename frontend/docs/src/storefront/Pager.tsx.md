# `src/storefront/Pager.tsx`

Source: [`src/storefront/Pager.tsx`](../../../src/storefront/Pager.tsx)

Accessible server-rendered pagination for category pages. It uses a localized landmark and page-of-total label, omits Previous on page one and Next on the final page, normalizes page one to the bare category path, and hides for a single-page result.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers page links and first/last controls; browser page tests cover navigation. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
