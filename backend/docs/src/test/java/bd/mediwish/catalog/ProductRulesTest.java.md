# `ProductRulesTest.java`

Source: [`src/test/java/bd/mediwish/catalog/ProductRulesTest.java`](../../../../../../../src/test/java/bd/mediwish/catalog/ProductRulesTest.java)

## Purpose

Exercises the pure Ticket 14 catalog rules. It checks normalization, every text field at its exact length limit and one character beyond, required Medicine fields and flags, Equipment's blank generic and null dosage rules, and control-character handling, including description line breaks. The permission test covers every `UserRole` × `CatalogArea` pair plus null role and area. Other cases cover pricing, unpriced activation, idempotent create comparisons and separate audit change types.

## Verification

All 11 unit tests passed. Control regressions cover the start, middle and end of every text field, plus edit normalization preserving invalid controls before stale/field checks.

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).
