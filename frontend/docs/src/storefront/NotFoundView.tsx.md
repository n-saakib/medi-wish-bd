# `src/storefront/NotFoundView.tsx`

Source: [`src/storefront/NotFoundView.tsx`](../../../src/storefront/NotFoundView.tsx)

Shared translated not-found content with one home recovery link. Root and store-group not-found routes reuse it so malformed, unavailable and unknown resources have the same customer-facing copy without resource details.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers its recovery link; browser tests cover catalog not-found responses. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
