# `src/storefront/ProductAbout.tsx`

Source: [`src/storefront/ProductAbout.tsx`](../../../src/storefront/ProductAbout.tsx)

Renders the accepted About section. Product description is ordinary escaped React text with visible line breaks; null brand, generic name, dosage form and manufacturer fields are omitted, while Sale Unit remains present. It adds no advice or safety claims.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers omitted fields, escaped content and line breaks. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
