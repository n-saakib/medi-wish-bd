# `TestDatabase.java`

Source: [`src/test/java/bd/mediwish/health/TestDatabase.java`](../../../../../../../src/test/java/bd/mediwish/health/TestDatabase.java)

## Purpose and reasoning

`TestDatabase` is the integration harness's database-safety boundary. Each test instance uses the explicit `medi_wish_test` database and creates one random schema named `mw_it_<32 hex characters>`. Before schema DDL and cleanup, it verifies PostgreSQL 18, the exact configured connection role, and that the role has none of the `SUPERUSER`, `CREATEDB` or `CREATEROLE` attributes. Guard failures identify the safe category without printing configured or connected role names. PostgreSQL itself enforces `CREATE SCHEMA` privilege; a denied DDL statement propagates without marking the schema as owned. Isolated Spring application properties explicitly select the `test` profile and include synthetic test-only auth prerequisites so local HTTP cookies are permitted while startup reaches the real database and migration checks.

The harness resolves each `TEST_DB_*` setting from the process environment first, a matching JVM system property second, and the ignored `backend/.env` last. This lets `mvn clean compile install` use a configured backend-local `.env` without a separate shell export while keeping production runtime configuration environment-driven. The file parser accepts only literal `NAME=value` lines, ignores comments and blank lines, and never evaluates or logs values.

## Fields, constructor and methods

| Member | Behavior and reason |
| --- | --- |
| `host`, `port`, `username`, `password` | Connection settings resolved from `TEST_DB_*` process variables, JVM properties or the ignored backend `.env`. Host/port are bounded; credentials are required and never logged. |
| `schema`, `created` | Random run-owned schema and lifecycle flag. `created` prevents cleanup before creation and prevents repeated cleanup. |
| `TestDatabase()` | Loads the test settings, validates the exact test database and generated schema, requires test credentials, and rejects malformed host or port values. |
| `loadSettings()` | Merges the optional local `.env` with process environment and JVM properties. Higher-priority sources replace the file value for the same key. |
| `defaulted(Map<String, String>, String, String)` | Applies safe localhost/5432 defaults only to blank host or port settings. The database name and credentials remain required. |
| `locateDotEnv()` | Looks for `.env` beside the backend `pom.xml` from the Maven working directory and its nearby project directory; it avoids reading a repository-root or unrelated parent `.env`. |
| `readDotEnv(Path)` | Parses comments, blank lines and literal uppercase `NAME=value` entries. It preserves values containing `=` and rejects malformed lines by ignoring them. |
| `create()` | Constructs the harness, connects to the test database, verifies database identity/version, creates the generated schema and marks it owned. |
| `validateTarget(String database, String schema)` | Allows only database `medi_wish_test` and schema format `mw_it_[a-f0-9]{32}`. It is package-visible so the guard unit test can exercise the safety rule without a database. |
| `required(Map<String, String>, String)` | Requires a nonblank resolved setting and reports which configuration key is missing without exposing its value. |
| `connect()` | Opens a PostgreSQL JDBC connection to the fixed validated test database with two-second connect and three-second socket limits. |
| `validateTestDatabaseConnection(String, int, String, String, boolean, boolean, boolean)` | Requires `medi_wish_test`, PostgreSQL 18, an exact match between the effective connection role and configured test username, and a role without `SUPERUSER`, `CREATEDB` or `CREATEROLE`. It reports which category failed without exposing role names or credentials. |
| `verifyDatabase(Connection connection)` | Queries current database, server version and effective role attributes, then applies the identity and restricted-attribute checks before allowing schema DDL or cleanup. |
| `applicationProperties()` | Returns Spring test properties using the normal database port. |
| `applicationProperties(int connectionPort)` | Selects the explicit `test` profile and returns isolated datasource, Liquibase default/liquibase schema, Hibernate default-schema and synthetic auth properties. It switches the host to loopback when a proxy port is supplied. |
| `syntheticAuthProperties()` | Returns a valid test-only Base64 HMAC key, a generated Argon2 dummy verifier and an explicit non-secure-cookie setting for local HTTP integration tests. It never reads or prints production credentials. |
| `schema()` | Returns the generated schema used by the current test run. |
| `host()` | Returns the configured upstream host for a test proxy. |
| `port()` | Returns the configured upstream PostgreSQL port for a test proxy. |
| `close()` | If this instance created its schema, revalidates the exact test target, verifies PostgreSQL again, drops only the owned schema with `CASCADE`, and clears the ownership flag. |

The class is `AutoCloseable` so integration tests can use try-with-resources. It owns a schema, never a whole database or the PostgreSQL service.

## Verification

`TestDatabaseGuardTest` covers accepted/rejected target combinations, predicate-specific safe messages, role mismatch/null/blank cases, separate `CREATEDB` and `CREATEROLE` rejections, and the literal `.env` parser without opening a database. `HealthIT`, `DependencyCompatibilityIT`, `UserIT`, `AuthIT` and `LegacyUserMigrationIT` use the live creation, property and cleanup paths with isolated PostgreSQL 18 schemas. Historical evidence records distinct runs: the 2026-09-23 Ticket 03 default and compatibility profiles passed 95 unit/24 integration cases; later Ticket 01/02 evidence on 2026-09-24 records 95/29, with one expected compatibility skip in the default profile and none in the compatibility profile. These are separate dated worktree snapshots, not a single run with competing totals. All predate the current exact-role/attribute checks and changeset 006, so none establishes current guard-backed migration/integration behavior. On 2026-09-24, the focused guard suite passed 5/5 on the dirty worktree based on `eb2f92d`; this database-free test does not execute the `pg_roles` query against PostgreSQL. A subsequent focused Failsafe attempt reached PostgreSQL but the guard rejected the connection before schema DDL or test assertions; its generic message did not identify which predicate failed. The guard now reports that category for future attempts; the historical failure remains unresolved until the same role is rechecked. Earlier preflight evidence identifying a superuser describes that earlier attempt, not a predicate proven by the subsequent generic report. No `*IT` body or schema mutation occurred in the latest recorded attempt. Database `CREATE` privilege is not separately preflighted; PostgreSQL enforces it for `CREATE SCHEMA`, and failed creation is not treated as an owned schema. The selected test role still needs a separate review of memberships and grants beyond the three checked role attributes. The focused [legacy migration evidence](<D:/Web Dev/medi-wish-bd/.scratch/launch-reconciliation/ticket-drafts/02 - Register a Customer with simple authentication/evidence/2026-09-23-legacy-migration.md>) records the historical 1/1 run and exact command. These successful checks supersede the earlier offline attempt blocked by the missing local `maven-jar-plugin:3.5.1` artifact.

On 2026-09-25, the focused guard suite passed 5/5 with the category-specific messages and missing/blank-role cases. Default and compatibility DB-free backend verification each passed 114/114 unit tests and explicitly skipped Failsafe; neither executed the changed live PostgreSQL preflight.
