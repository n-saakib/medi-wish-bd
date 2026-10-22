# `src/storefront/Pager.tsx`

Source: [`src/storefront/Pager.tsx`](../../../src/storefront/Pager.tsx)

Accessible server-rendered pagination for category pages. It uses a localized landmark and page-of-total label, omits Previous on page one and Next on the final page, normalizes page one to the bare category path, and hides for a single-page result.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers page links and first/last controls; browser page tests cover navigation. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
