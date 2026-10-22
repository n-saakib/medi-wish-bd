# `PublicCatalogQueriesIT.java`

Source: [`src/test/java/bd/mediwish/catalog/PublicCatalogQueriesIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/PublicCatalogQueriesIT.java)

## Purpose

Ticket 17 T7 query-cost and payload-size checks for the anonymous storefront reads. It follows the `CatalogQueriesIT` pattern: enable Hibernate statistics, send a warm-up request, `clear()`, then read the measured request's `getPrepareStatementCount()`. Tag: `integration`. It was written test-first.

- **Statement counts (E5):** the category page with 1 Product costs the same as the page with 24 Products, each with a main image and a Product Discount. Details with 1 image cost the same as details with 8 images. `GET /api/categories` with 2 listable categories costs the same as with 20. The absolute numbers are printed (`T17 SQL counts: ...`) for the evidence. The production `findMainImages` JPQL now batches position-zero images. The retained Hibernate report supplies total prepared-statement counts, without a stable per-query statistics key; this test intentionally asserts the observable constant total rather than coupling to that key. Main images and Discounts are present on every measured card, and `PublicCatalogServiceTest` separately verifies one main-image batch call for the complete page.
- **Payload sizes (E2):** two worst-case responses are each smaller than the frontend's 262,144-byte read limit. The first is a page of 24 maximum-length ASCII cards: name 160, generic name 200, Sale Unit 80, a 160-character image alt and a Discount. The second is a details response with every text field at its limit, a 4,000-character description and 8 images with 160-character alts. The byte lengths are printed (`T17 payload bytes: ...`).

## Running it alone

```powershell
.\mvnw.cmd -o verify "-Dit.test=PublicCatalogQueriesIT" "-Dtest=NONE" "-Dsurefire.failIfNoSpecifiedTests=false"
```

## Verification

Written test-first on 2026-10-17. The retained 2026-10-20 run at `c63359c` plus the uncommitted implementation passed both tests: page statements 5/5 (1/24 cards), details 3/3 (1/8 images), categories 1/1 (2/20 categories). Measured payloads were 23,034 bytes for the 24-card page and 7,412 bytes for the 8-image details, both below 262,144. The cumulative backend run passed 999 unit tests and 348 integration tests, including compatibility. These are recorded results, not a new execution for the documentation refresh.
