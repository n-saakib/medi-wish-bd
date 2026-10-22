# `src/storefront/ProductDetailsView.tsx`

Source: [`src/storefront/ProductDetailsView.tsx`](../../../src/storefront/ProductDetailsView.tsx)

Server-rendered Product details composition: category breadcrumb, selectable gallery, projected price, Sale Unit, conditional review note and About section. It includes no purchase controls, usage/safety tabs or related row. The route supplies only the strict public projection, and this component adds no local product policy.

The review note appears whenever `requireValidation` is set, for medicines and Equipment alike, so its `storefront.reviewNote` copy names a "product" rather than a "medicine". This owner decision (2026-10-22) replaces the plan's medicine-specific wording.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers the conditional note and details composition. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
