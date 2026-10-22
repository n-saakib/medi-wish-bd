# `src/storefront/NotFoundView.tsx`

Source: [`src/storefront/NotFoundView.tsx`](../../../src/storefront/NotFoundView.tsx)

Shared translated not-found content with one home recovery link. Root and store-group not-found routes reuse it so malformed, unavailable and unknown resources have the same customer-facing copy without resource details.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers its recovery link; browser tests cover catalog not-found responses. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
