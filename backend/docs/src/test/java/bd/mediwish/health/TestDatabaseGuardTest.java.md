# `TestDatabaseGuardTest.java`

Source: [`src/test/java/bd/mediwish/health/TestDatabaseGuardTest.java`](../../../../../../../src/test/java/bd/mediwish/health/TestDatabaseGuardTest.java)

## Purpose and test boundary

This fast unit test protects the destructive boundary in `TestDatabase` without opening a database. It verifies the test database/schema allow-list, predicate-specific secret-safe guard messages, rejects mismatched/missing roles, superuser, `CREATEDB` and `CREATEROLE` roles and non-PostgreSQL-18 identities, and checks that the local `.env` fallback accepts only literal settings.

## Class and method

| Member | Behavior and reason |
| --- | --- |
| `refusesDevelopmentDatabaseAndNonOwnedSchemas()` | Accepts one valid `medi_wish_test`/run-owned schema pair, rejects development/PostgreSQL/parameterized database names, rejects public/other-run/injection-shaped schemas, and rejects null values. |
| `refusesConnectionsOutsideTheConfiguredNonSuperuserTestRole()` | Accepts a matching test-role identity with all three restricted attributes false and rejects a wrong database/version, a role mismatch, a missing/blank effective role and a missing configured role; each failure has a safe category message that does not reveal role names. |
| `refusesRolesWithCreatedbPrivilege()` | Rejects the configured role when PostgreSQL reports its `CREATEDB` attribute. |
| `refusesRolesWithCreaterolePrivilege()` | Rejects the configured role when PostgreSQL reports its `CREATEROLE` attribute. |
| `readsLiteralDotEnvValuesWithoutEvaluatingOrExposingThem()` | Reads a temporary `.env` fixture, preserves a value containing `=`, ignores comments and malformed lines, and verifies that parsing is data-only. |

The database-free tests cover the database/schema allow-list, role identity attributes and literal `.env` parsing; the same guard runs before schema creation and cleanup.

## Verification

Run with `.\mvnw.cmd -Dtest=TestDatabaseGuardTest test` from `backend/`. The focused run on 2026-09-24 passed 5/5 using the offline Maven cache; it has no external database dependency. PostgreSQL-backed `*IT` tests were not run for this guard change. A 2026-09-25 red/green follow-up first failed three old generic-message assertions, then passed 5/5 after the guard began identifying the failed database/version/role/privilege category without printing role names; null, blank and missing configured-role cases are included. No PostgreSQL connection or DDL was used for this check.
