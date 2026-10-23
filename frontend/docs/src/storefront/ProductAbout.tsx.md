# `src/storefront/ProductAbout.tsx`

Source: [`src/storefront/ProductAbout.tsx`](../../../src/storefront/ProductAbout.tsx)

Renders the accepted About section. Product description is ordinary escaped React text with visible line breaks; null brand, generic name, dosage form and manufacturer fields are omitted, while Sale Unit remains present. It adds no advice or safety claims.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers omitted fields, escaped content and line breaks. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
