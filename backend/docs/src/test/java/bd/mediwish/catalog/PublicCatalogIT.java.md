# `PublicCatalogIT.java`

Source: [`src/test/java/bd/mediwish/catalog/PublicCatalogIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/PublicCatalogIT.java)

## Purpose

Ticket 17 T5 contract test for the three anonymous storefront reads (`GET /api/categories`, `GET /api/categories/{id}/products?page=n`, `GET /api/products/{id}`), over real HTTP and PostgreSQL in a run-owned schema. Tags: `integration`, `security`. It was written test-first and now runs against the implemented public read model, controller and security matchers.

One per-class fixture (`DiscountTestApi`, null actor for reads) seeds: category A with 25 active medicines and one active equipment Product, plus one inactive and one draft medicine, two images on one medicine reordered through the staff API, and a 10% Category Discount; two more listable categories; an empty active category; an active category that holds only an inactive Product; and a category with one Product and a 5% Discount that is then deactivated. Every name is a shared random token plus a two-letter code whose first letter alternates case (`aa`, `Ab`, `ac`, ...), so `lower(name)` order differs from byte order on any collation. One equipment name (`AY`) ties the last medicine (`ay`) after lower-casing, so the id decides their order.

- **Listable categories:** equal bodies for anonymous, Admin-token and `Bearer invalid` readers; exact `{id, name}` keys; only active categories with an active priced Product, in `lower(name), id` order.
- **Category page:** 24 cards in name-then-id order, exact card keys `id, name, genericName, saleUnit, image, price`, `totalItems` 26; page 1 holds the last 2 cards and page 2 is 404. The page values `-1`, `abc`, empty, `01`, `+1`, `%2B1`, `1.0`, a 10-digit value and a repeated `page` are all 404, and `?size=50` is ignored. Empty active categories and active categories holding only inactive Products return `items: []` at page 0 and 404 at page 1. Inactive, unknown and malformed category ids are 404.
- **Details:** exact keys; images in the reordered `display_order` with `altText` null where unset; equipment has null `genericName` and `dosageForm`; a Product in an inactive category is 200 with `category: null`, and that category's Discount still applies. The category card uses the new position-0 image.
- **Not found:** inactive, draft, only-inactive-category, unknown and malformed Product ids, plus the price route, share one `404 NOT_FOUND` body (only `requestId` differs).
- **Price parity:** every 200 card and details `price` equals `GET /api/products/{id}/price` without `productId`.
- **Headers:** the shared harness checks `Cache-Control: no-store` and a generated `X-Request-ID` on every response; `read` also checks the JSON content type and the absence of `Set-Cookie`.
- **Id case (P16):** upper-case Product and category ids return the same body as the lower-case form, like the price route. Only the frontend pages refuse them.

The class also holds the static fixture and shape helpers (`category`, `listed`, `draft`, the `image` multipart upload, `ok`, `notFound`, `priceRoute`, the key-set constants and the shape assertions). `PublicCatalogRegressionIT` and `PublicCatalogQueriesIT` reuse them.

## Running it alone

From `backend/`, with the guarded test cluster on port 55432:

```powershell
.\mvnw.cmd -o verify "-Dit.test=PublicCatalogIT" "-Dtest=NONE" "-Dsurefire.failIfNoSpecifiedTests=false"
```

## Verification

Prepared test-first on 2026-10-17. All six cases passed in the 2026-10-20 cumulative UTF-8 integration run, including the compatibility profile. See the backend Ticket 17 E2E report for commands, revision and the wider 348-case integration result.
