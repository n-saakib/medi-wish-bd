# `tests/browser/storefrontApi.spec.ts`

Source: [`../../../tests/browser/storefrontApi.spec.ts`](../../../tests/browser/storefrontApi.spec.ts)

Ticket 17 T5 contract specs. They send real HTTP to the built jar and the guarded PostgreSQL browser schema to test the three anonymous catalog reads of plan §4.0.1: `GET /api/categories`, `GET /api/categories/{id}/products?page=n` (0-based, 24 per page) and `GET /api/products/{id}`. Data is seeded through the staff routes with `catalogSupport.ts` actors and the `seedCategory`/`seedEquipment` fixtures. Every name carries a `token()`, and responses are checked with the test-owned guards in `storefrontSupport.ts` (exact key sets, no-store, request id, no cookie, bounded `404 NOT_FOUND` envelope). No production code is imported.

Acceptance IDs:

- **E2E-17-01**: a category with an active, priced Product is listed as exactly `{id, name}`. The spec's own empty category, inactive category and only-inactive-Product category are absent. The anonymous, Admin-bearer and `Bearer invalid` bodies are equal. Only the spec's own tokens are asserted, never the whole list.
- **E2E-17-02** (one 25-Product category seeded in `beforeAll`): page 0 has 24 cards in `lower(name), id` order, using `orderedNames` mixed case so byte order would differ. Page 1 holds the 25th card and page 2 is 404. Invalid values (`-1`, `01`, `1.5`, `1e2`, `abc`, empty, ` 1`, `1,0`, past-end, 10 digits, repeated `page`) give bodies identical to an unknown category's, minus `requestId`. Explicit `page=0` equals the bare route, and `size=50` is ignored. An empty active category answers `200` with `items: []`, and its page 1 is 404. Inactive, unknown and malformed category ids give identical 404s.
- **E2E-17-03**: the full details body for a medicine, compared with `toEqual`. Its two uploaded images come back in order with stored and `null` alt, the card shows image 0, and `price` equals `publicPrice()` without `productId` (`@cross-15-17`). Equipment has `genericName`/`dosageForm` `null` on both details and card. A Product of an inactive category is readable with `category: null`. Inactive, unpriced draft, priced-but-inactive, unknown and malformed ids give one 404 body, identical to the price route's. The API accepts an upper-case UUID (P16); only the pages reject it.
- **E2E-17-04** (`@cross-16-17`, `assertAwayFromDhakaMidnight()` in `beforeAll`): a 10% Category Discount gives `{CATEGORY, PERCENTAGE, "10"}`, and a ৳15.00 Product Discount on a Product in another category gives `{PRODUCT, FLAT, "15.00"}`. Card and details prices equal the price route. Discounts starting tomorrow are not applied.

Tags: `@t17`, `@t17-T5`, `@t17-api`, plus the cross tags above. Target the file with `npm run test:browser -- --grep @t17-api`, or one behaviour by id, for example `--grep "E2E-17-02"`. Run it through the plan's `browser.ps1` harness on the UTF8 cluster (55433).

Local helpers: `publicImageOf` (staff image view to public image), `uploaded` (upload and expect `201`) and `apiMalformedIds` (`malformedIds` without the upper-case form).

Written test-first before the public routes existed. The production read model, routes and security matchers are now implemented. These tests run normally, without expected-failure markers; current results are in the Ticket 17 E2E report.
