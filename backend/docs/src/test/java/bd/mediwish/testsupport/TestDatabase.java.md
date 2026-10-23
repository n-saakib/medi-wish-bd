# `TestDatabase.java`

Source: [`src/test/java/bd/mediwish/testsupport/TestDatabase.java`](../../../../../../../src/test/java/bd/mediwish/testsupport/TestDatabase.java)

## Purpose

Owns one disposable schema `mw_it_<32 hex>` in `medi_wish_test`, never a database or another run's schema. Before DDL and cleanup it requires PostgreSQL 18, the exact configured role and a role without `SUPERUSER`, `CREATEDB` or `CREATEROLE`; guard messages name the failed category without role names. Settings come from `TEST_DB_*` process variables, then JVM properties, then the ignored `backend/.env` (literal `NAME=value` lines only).

| Member | Behavior |
| --- | --- |
| `create()` / `close()` | Verifies the target and creates the schema; `close()` revalidates and drops only that schema with `CASCADE`. |
| `connect()` | JDBC connection whose unqualified names resolve in the schema (`currentSchema`), with 2 s connect and 3 s socket limits. |
| `update`, `query`, `single`, `Row` | Parameterized statements in the schema for test setup and assertions; `update` and `query` bind positional parameters through one private `bind`. |
| `applicationProperties()` / `(int port)` | Random server port; datasource, Liquibase and Hibernate schema settings; the JobRunr table prefix, used only when the compatibility profile adds JobRunr, so each application keeps JobRunr's tables in its own schema; and synthetic auth settings. A proxy port switches the host to loopback. The `test` profile is activated by `TestApplication.launch`, not by a property. |
| `syntheticAuthProperties()` | Test-only Base64 HMAC key, the synthetic 32-byte MFA key from `TestAuthSettings` (`app.auth.mfa.secret-key`) and non-secure cookies for local HTTP. |
| `schema()`, `host()`, `port()` | The generated schema and upstream address for proxies. |

## Verification

`TestDatabaseGuardTest` covers the guards without a database; every `*IT` exercises creation, properties and cleanup.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests. The integration tests that use it passed in the targeted run.

## Ticket 15 image storage

Owns one guarded disposable PostgreSQL18 test schema and a matching test-it- storage namespace under the discovered backend target/test-object-storage root. Application properties include synthetic auth and storage settings. close validates ownership, drops only its schema and deletes only its namespace. Credential values are never printed; development credentials are never fallback inputs.


## Ticket 05 recovery

Synthetic auth properties now include the recovery HMAC key. This unprofiled settings helper intentionally leaves mail transport disabled; profiled TestApplication startup selects memory capture.
