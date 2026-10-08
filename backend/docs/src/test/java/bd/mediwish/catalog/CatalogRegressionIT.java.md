# `CatalogRegressionIT.java`

Source: [`src/test/java/bd/mediwish/catalog/CatalogRegressionIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/CatalogRegressionIT.java)

## Purpose

Sends unwanted catalog fields, create activation, an array body and an otherwise-valid JSON body over 16 KiB; rejected requests leave the stored record and history unchanged. Compares complete earlier audit rows, including their event timestamps, after deactivation, proves the RESTRICT foreign keys, checks the absence of stock-like columns, and probes PostgreSQL price and activation constraints. Exercises every staff route with Customer, DeliveryPerson and MFA-restricted Admin sessions; it also verifies role rereading after demotion and checks captured output for product names and prices.

## Verification

All three integration, regression and security tests passed. PostgreSQL RESTRICT refusals require SQLSTATE `23001` and preserve the category, Product and complete immutable history rows. Captured-log checks retain category, product, search and price privacy assertions.

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).

Final cumulative verification on2026-10-07,8b6924c plus frozenWIP: normal verify passed739 units and158executed integration checks (one expected compatibility-only skip) at15:27:47; compatibility verify passed739 units and159integration checks with no skips at15:34:26. Logs: main-checkout `.scratch/ticket14-verification/final-backend-{full,compatibility}-20261007.log`. All136production class/resource payloads match the ordinary browser runtime; the compatibility profile adds optional dependency jars only.

Two review regressions exercise actual HTTP binding and PostgreSQL. Both product/category list routes reject overflowing page offsets with no-store 400 INVALID_REQUEST, separately reject an out-of-range page integer, and retain empty 200 pages for representable near-limit and ordinary past-end offsets. Raw duplicate name keys characterize last-value-wins in the pinned Jackson 3.1.5 JsonNode mapper; an identical retry returns the same stored category and a final invalid scalar is rejected without a second category. Duplicate rejection remains outside the accepted T1 scope; shared mapper behavior is unchanged.

Correction verification on 2026-10-07 at 22:06:45 Asia/Dhaka, revision `8b6924c` plus current WIP: guarded offline Maven `verify -Dit.test=CatalogRegressionIT` passed all 746 unit tests and all 5 catalog regression integration tests with zero failures/errors/skips. Disposable roles/schemas were released. Logs: main-checkout `.scratch/ticket14-verification/review-pagination-{red-units,green-units,focused-backend}-20261007.log`; red units had 4 expected overflow-refusal failures, green units passed 12/12. The full cumulative normal and compatibility gates are still pending for this corrected candidate.
