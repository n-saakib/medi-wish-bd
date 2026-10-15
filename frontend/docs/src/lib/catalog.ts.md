# `src/lib/catalog.ts`

Source: [`src/lib/catalog.ts`](../../../src/lib/catalog.ts)

The staff catalog HTTP boundary. It projects bounded Category, Product summary, Product detail and change-history responses; an invalid shape becomes `INVALID_RESPONSE`. History validation requires a new selling price for `PRICE_CHANGED` and boolean before/after flags for `REQUIRE_VALIDATION_CHANGED`, preventing a render failure or an invented review direction. Created events retain their legitimate nullable money and prior flag fields; optional MRP and unrelated history fields remain nullable. Money remains a two-decimal string, and `formatTaka` groups its digits without floating-point conversion. The caller supplies the translated currency symbol.

`createCatalogClient` uses the session's authenticated fetch for category/product reads and commands. `listCategoryOptions` collects all active category pages; `listCategories` and `listProducts` remain paged. Category and Product creates carry a client UUID for safe retries. Catalog and pricing updates use separate routes and request bodies, both with the server version. Successful catalog response bodies may use up to 256 KiB to fit a valid 50-item page; error bodies and other API clients retain the shared 16 KiB bound.

`tests/catalog.test.ts` checks decimal and type-specific history projection, the existing bounded error-copy mapping for malformed history, formatting, category pagination and the pricing route/body.

## Ticket 16

Ticket 16 adds effectivePrice and appliedDiscount to Product projections and rejects inconsistent null-price or malformed discount data. Derived DISCOUNT_STARTED/DISCOUNT_ENDED history requires its typed discount snapshot; stored events require discount:null. moneyCents is shared by the Product pricing and Discount input validation; client display does not recalculate discounted prices.
