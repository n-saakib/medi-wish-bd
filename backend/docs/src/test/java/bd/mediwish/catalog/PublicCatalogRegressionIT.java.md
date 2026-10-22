# `PublicCatalogRegressionIT.java`

Source: [`src/test/java/bd/mediwish/catalog/PublicCatalogRegressionIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/PublicCatalogRegressionIT.java)

## Purpose

Ticket 17 T6 regression, security and recovery guards for the anonymous storefront reads, over real HTTP and PostgreSQL. Tags: `integration`, `regression`, `security`; it uses `OutputCaptureExtension`. Each test starts its own `DiscountTestApi` and checks that the captured output holds none of its seeded unique names, ids or page values. It was written test-first and now runs against the implemented public catalog; current execution evidence is in the backend Ticket 17 E2E report.

- **Purchase bypass (R1, C2):** deactivating a Product closes its details, its category-page card and its price route at once; reactivating restores all three. Deactivating the category makes its page 404 and removes it from the category list, while the Product's details stay 200 with `category: null`.
- **Injected content:** a Product name `<script>alert(1)</script>`, description `<img src=x onerror=alert(1)>`, category name `"><svg onload=alert(1)>` and image alt `<b>x</b>` come back exactly as stored. Escaping is the frontend's job.
- **Field authorization (E1):** list, page and details have exactly the contract keys. No `version`, `status`, `active`, `updatedBy`, `updatedAt`, `history`, `productCount`, `objectKey`, `sha256`, `byteSize` or `contentType` key appears at any depth. Distinctive page values (`918273645`, `1234567890`) and ids never reach the log.
- **Freshness (E4):** a Category Discount that starts tomorrow is not applied. After `DiscountTestApi.today(...)` moves the Asia/Dhaka day, the next page and details reads apply it, with no restart.
- **Read concurrency:** 3 readers and 1 writer use a `CyclicBarrier` to witness one inactive page (`totalItems: 29`) and one active page (`totalItems: 30`) before 18 further reads per reader race with the remaining 9 deactivate/reactivate cycles. This gives 20 reads per reader and 10 writer cycles, with no sleeps. Four threads match the Hikari pool of 4 and its 1000 ms connection timeout. Every response is 200 with `min(24, totalItems)` distinct ids and the exact undiscounted `10.00` price projection on each card. The toggled Product is present exactly when `totalItems` is 30, which shows the count and the page come from one snapshot. The writer changes activation only, so this case does not prove a price transition is atomic.
- **Restart:** after `restart(DiscountTestApi.TODAY)` the three reads return identical bodies (200 bodies carry no `requestId`).
- **Oversized input:** a 5,000-character id on the details and category routes gives a bounded 4xx that does not echo the value, and the status is printed for the evidence. A 10-digit page and a 5,000-digit page give the 404 envelope.

N/A, recorded in the class Javadoc: duplicate, stale and concurrent commands and lost-response replay do not apply, because the story adds only idempotent GETs.

## Running it alone

```powershell
.\mvnw.cmd -o verify "-Dit.test=PublicCatalogRegressionIT" "-Dtest=NONE" "-Dsurefire.failIfNoSpecifiedTests=false"
```

## Verification

Written test-first on 2026-10-17. `.\mvnw.cmd -o -q test-compile` passes. The test has not been run yet.
