# `TestDatabaseGuardTest.java`

Source: [`src/test/java/bd/mediwish/health/TestDatabaseGuardTest.java`](../../../../../../../src/test/java/bd/mediwish/health/TestDatabaseGuardTest.java)

## Purpose and test boundary

This fast unit test protects the destructive boundary in `TestDatabase.validateTarget` without opening a database. It keeps development, default PostgreSQL and injection-shaped targets outside the integration harness.

## Class and method

| Member | Behavior and reason |
| --- | --- |
| `refusesDevelopmentDatabaseAndNonOwnedSchemas()` | Accepts one valid `medi_wish_test`/run-owned schema pair, rejects development/PostgreSQL/parameterized database names, rejects public/other-run/injection-shaped schemas, and rejects null values. |

The test focuses on the allow-list and schema pattern because that rule protects every later cleanup operation.

## Verification

Run with the Maven unit suite (`test`). It has no external database dependency.
