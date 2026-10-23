# `src/storefront/ProductDetailsView.tsx`

Source: [`src/storefront/ProductDetailsView.tsx`](../../../src/storefront/ProductDetailsView.tsx)

Server-rendered Product details composition: category breadcrumb, selectable gallery, projected price, Sale Unit, conditional review note and About section. It includes no purchase controls, usage/safety tabs or related row. The route supplies only the strict public projection, and this component adds no local product policy.

The review note appears whenever `requireValidation` is set, for medicines and Equipment alike, so its `storefront.reviewNote` copy names a "product" rather than a "medicine". This owner decision (2026-10-22) replaces the plan's and `ui-design/product.html`'s medicine-specific wording; it is recorded as a design deviation in the [Ticket 17 E2E report](<../../ticket-17-e2e.md#review-follow-up-2026-10-22>).

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers the conditional note and details composition. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures. Those browser passes checked the previous medicine-specific note; the product-neutral copy passed the browser `reviewNote` assertions on 2026-10-22. On 2026-10-22 the working tree on `c9568a6` with the review fixes passed `npm run verify` (42 files, 1,031 units and the production build) and the Ticket 17 Chrome/Edge browser suites (`--grep "@t17"`: 110 passed, 2 demo skips; `@t17-demo` alone: 2 passed); see the [review follow-up](<../../ticket-17-e2e.md#review-follow-up-2026-10-22>).
