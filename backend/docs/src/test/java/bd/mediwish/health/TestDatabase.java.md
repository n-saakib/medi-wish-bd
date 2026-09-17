# `TestDatabase.java`

Source: [`src/test/java/bd/mediwish/health/TestDatabase.java`](../../../../../../../src/test/java/bd/mediwish/health/TestDatabase.java)

## Purpose and reasoning

`TestDatabase` is the integration harness's database-safety boundary. Each test instance uses the explicit `medi_wish_test` database and creates one random schema named `mw_it_<32 hex characters>`. It validates the target before connection or cleanup, so tests can run against shared PostgreSQL without falling back to development data or dropping another run's schema.

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
| `verifyDatabase(Connection connection)` | Queries current database and server version and requires `medi_wish_test` on PostgreSQL major version 18 before allowing test work. |
| `applicationProperties()` | Returns Spring test properties using the normal database port. |
| `applicationProperties(int connectionPort)` | Returns isolated datasource, Liquibase default/liquibase schema and Hibernate default-schema properties. It switches the host to loopback when a proxy port is supplied. |
| `schema()` | Returns the generated schema used by the current test run. |
| `host()` | Returns the configured upstream host for a test proxy. |
| `port()` | Returns the configured upstream PostgreSQL port for a test proxy. |
| `close()` | If this instance created its schema, revalidates the exact test target, verifies PostgreSQL again, drops only the owned schema with `CASCADE`, and clears the ownership flag. |

The class is `AutoCloseable` so integration tests can use try-with-resources. It owns a schema, never a whole database or the PostgreSQL service.

## Verification

`TestDatabaseGuardTest` covers accepted/rejected target combinations and the literal `.env` parser. `HealthIT` and `DependencyCompatibilityIT` use the live creation, property and cleanup paths with real PostgreSQL 18. The normal Maven lifecycle therefore works with either process variables or the configured backend `.env`.
