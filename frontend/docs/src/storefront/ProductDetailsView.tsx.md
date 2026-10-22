# `src/storefront/ProductDetailsView.tsx`

Source: [`src/storefront/ProductDetailsView.tsx`](../../../src/storefront/ProductDetailsView.tsx)

Server-rendered Product details composition: category breadcrumb, selectable gallery, projected price, Sale Unit, conditional review note and About section. It includes no purchase controls, usage/safety tabs or related row. The route supplies only the strict public projection, and this component adds no local product policy.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers the conditional note and details composition. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
