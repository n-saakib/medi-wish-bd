# `ConcurrentCatalogIT.java`

Source: [`src/test/java/bd/mediwish/catalog/ConcurrentCatalogIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/ConcurrentCatalogIT.java)

## Purpose

Forces two HTTP mutations to overlap using a separate transaction that owns the target PostgreSQL row or an uncommitted seed insert. Each race waits until two application backends are observed in that transaction's lock queue, then releases it. A recursive `pg_blocking_pids` graph counts direct and transitive lock waiters within the current test database and role: PostgreSQL can queue the second tuple locker behind the first application request. `UNION` deduplicates graph nodes. The seed PID is excluded from the count, and both requests must still be observed waiting before rollback; there is no fixed delay.

Cases cover two same-version catalog writes, price versus activation, identical and different same-ID creates, case-twin category names, and a lost pricing response retried with the old version. Assertions include final records and history counts. This fixture alone starts application JDBC connections with a 15-second socket timeout, beyond the seven-second observed-overlap deadline; the ten-second HTTP request and twelve-second future bounds remain unchanged. Global database and application helpers retain their normal defaults.

## Verification

All five integration and regression tests passed, covering six races/retry cases. The corrected transitive blocker observation and scoped socket timeout passed both row-update races as well as same-ID creates, case-twin names and idempotent retry.

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).

Final cumulative verification on2026-10-07,8b6924c plus frozenWIP: normal verify passed739 units and158executed integration checks (one expected compatibility-only skip) at15:27:47; compatibility verify passed739 units and159integration checks with no skips at15:34:26. Logs: main-checkout `.scratch/ticket14-verification/final-backend-{full,compatibility}-20261007.log`. All136production class/resource payloads match the ordinary browser runtime; the compatibility profile adds optional dependency jars only.
