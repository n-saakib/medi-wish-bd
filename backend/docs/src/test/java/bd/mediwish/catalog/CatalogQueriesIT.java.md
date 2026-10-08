# `CatalogQueriesIT.java`

Source: [`src/test/java/bd/mediwish/catalog/CatalogQueriesIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/CatalogQueriesIT.java)

## Purpose

Measures the catalog through real authenticated HTTP requests and PostgreSQL in a run-owned schema. With 60 deterministically named products in five categories, the five-item page touches one category and the twenty-item page all five; both item counts and category coverage are asserted so a lazy category load cannot hide behind a random small page. Records prepared statement counts for those pages, details with one/twenty history entries from distinct synthetic actors, category listing and every mutation route. Relative count bounds catch category/history N+1 growth; absolute bounds include current-role/MFA authentication (16 for category routes, 24 for Product mutations). API projections, prices, latest-20 history, positive measured counts and resource bounds are asserted.

A separate 1,000-row synthetic fixture records `EXPLAIN ANALYZE BUFFERS` for category plus literal substring filtering using the repository escape character (`!`) and stable sorting. This execution plan is informational; Ticket 59 owns load/latency acceptance. It establishes no product timing SLA.

## Verification

Both integration tests passed. Measured prepared statement counts, including authentication:

| Operation | Statements |
| --- | ---: |
| Product page, size 5 | 6 |
| Product page, size 20 | 6 |
| Detail, one history entry | 8 |
| Detail, twenty history entries | 8 |
| Pricing update | 11 |
| Category list | 6 |
| Category create | 7 |
| Category update | 7 |
| Product create | 11 |
| Catalog update | 11 |

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).

Final cumulative verification on2026-10-07,8b6924c plus frozenWIP: normal verify passed739 units and158executed integration checks (one expected compatibility-only skip) at15:27:47; compatibility verify passed739 units and159integration checks with no skips at15:34:26. Logs: main-checkout `.scratch/ticket14-verification/final-backend-{full,compatibility}-20261007.log`. All136production class/resource payloads match the ordinary browser runtime; the compatibility profile adds optional dependency jars only.
Commit preparation removes an extra blank line at the end of the source file; query assertions and measured behavior are unchanged.
