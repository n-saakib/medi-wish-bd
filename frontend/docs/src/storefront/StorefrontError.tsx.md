# `src/storefront/StorefrontError.tsx`

Source: [`src/storefront/StorefrontError.tsx`](../../../src/storefront/StorefrontError.tsx)

Client recovery view used by the store error boundary. It presents translated generic copy and a retry button wired to Next.js `retry()`. Although the boundary passes the error for framework compatibility, the view never renders its message, digest, API response or origin.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) checks that retry is called and diagnostic text stays hidden. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
