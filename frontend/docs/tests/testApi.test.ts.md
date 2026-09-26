# `tests/testApi.test.ts`

Source: [`tests/testApi.test.ts`](../../tests/testApi.test.ts)

## Purpose

Unit coverage for the browser-test setup in [`tests/browser/testApi.ts`](browser/testApi.ts.md). It lives outside `tests/browser/` so Playwright does not collect it. `psql` and the Java process are mocked (`node:child_process`), the log file is mocked (`node:fs`), and `fetch` is stubbed; no database or API is needed.

## Verification

- **`apiEnvironment`:** inherited `SPRING_DATASOURCE_*`, a lower-case `spring_liquibase_url`, a dotted `spring.datasource.password`, `SPRING_APPLICATION_JSON`, `SPRING_CONFIG_ADDITIONAL_LOCATION`, `DB_*`, `APP_*` and the three JVM option variables are dropped; `PATH`, `SystemRoot` and `JAVA_HOME` are kept.
- **Occupied port:** with a real listener on `127.0.0.1:18080`, setup rejects with "already in use" and never calls `psql` or starts Java.
- **Normal start:** the API gets the run-owned `mw_browser_<12 hex>` role, `medi_wish_test` and the `test` profile; the last setup query is the Liquibase check on that role's schema, and the teardown drops the role.
- **Failed start:** when the API exits during startup, or is ready but has not migrated the run's schema, setup rejects with the matching message and drops the role.
