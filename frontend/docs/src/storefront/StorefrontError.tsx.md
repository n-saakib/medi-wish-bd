# `src/storefront/StorefrontError.tsx`

Source: [`src/storefront/StorefrontError.tsx`](../../../src/storefront/StorefrontError.tsx)

Client recovery view used by the store error boundary. It presents translated generic copy and a retry button wired to Next.js `retry()`. Although the boundary passes the error for framework compatibility, the view never renders its message, digest, API response or origin.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) checks that retry is called and diagnostic text stays hidden. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
