# `CatalogTestApi.java`

Source: [`src/test/java/bd/mediwish/catalog/CatalogTestApi.java`](../../../../../../../src/test/java/bd/mediwish/catalog/CatalogTestApi.java)

## Purpose

Starts the real application against a guarded, run-owned PostgreSQL schema. Synthetic actors register and sign in through HTTP; staff complete real MFA enrollment before receiving a verified Bearer token. Package-visible `application()` and `database()` let sibling integration tests inspect persistence and restart the context. `send` uses `TestApplication`, which asserts `Cache-Control: no-store` and server-generated request IDs on every response. Helpers construct valid category, medicine, equipment, catalog-edit and pricing requests without bypassing authentication or business rules.

`start()` retains the three-second JDBC socket timeout used by the guarded test database harness. `start(int socketTimeoutSeconds)` lets only the catalog concurrency fixture request a 15-second application JDBC timeout while observing a controlled PostgreSQL lock for up to seven seconds. The property helper copies the startup map and replaces only the URL's existing `socketTimeout` parameter; database, schema, credentials, connection timeout and the caller's map remain unchanged. Zero or negative timeouts are rejected so the fixture cannot disable its read deadline. The direct database observation connections and global test helpers retain their defaults. Startup failure closes the owned schema.

Ticket 16 adds `start(Class<?>... testConfigurations)` and `start(int socketTimeoutSeconds, Class<?>... testConfigurations)`. Existing calls retain their defaults; explicit sources pass straight to `TestApplication.start`, allowing only requesting fixtures to launch the movable Discount calendar. The thin `DiscountTestApi` wrapper reuses all existing registration/MFA and catalog fixture behavior.

## Verification

The new launch overloads are prepared for Ticket 16 test-first integration; their real calendar/race verification remains pending until its production contracts exist. Historical results below describe the preceding catalog harness.

The real HTTP fixture was exercised by all 11 selected catalog integration tests; its three helper units also passed.

The guarded PostgreSQL 18 gate passed 739 unit tests and all 11 selected catalog integration tests on 2026-10-07 at 10:26:58 Asia/Dhaka, revision `8b6924c` plus Ticket 14 working changes. Offline Maven `verify` selected `CatalogRegressionIT,ConcurrentCatalogIT,CatalogMigrationIT,CatalogQueriesIT`, using disposable test credentials and run-owned schemas. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.

Evidence: [guarded T6/T7 run](<D:/Web Dev/medi-wish-bd/.scratch/ticket14-verification/t6-t7-confirmed-backend-20261007.log>).
