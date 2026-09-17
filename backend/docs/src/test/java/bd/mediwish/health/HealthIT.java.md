# `HealthIT.java`

Source: [`src/test/java/bd/mediwish/health/HealthIT.java`](../../../../../../../src/test/java/bd/mediwish/health/HealthIT.java)

## Purpose and test boundary

`HealthIT` is the main Story 01 cumulative integration test. It launches the real application against a run-owned schema in PostgreSQL 18, calls the actual HTTP endpoints and checks the liveness/readiness, security, correlation, recovery and migration contracts together. Ordered tests make the lifecycle explicit: start, inspect, interrupt, recover, restart and clean up.

The test is tagged `integration` and `regression`; selected methods also carry `sanity`, `contract`, `security`, `recovery` and `migration` tags.

## Fields and lifecycle methods

| Member | Behavior and reason |
| --- | --- |
| `client`, `json` | Bounded-time Java HTTP client and Jackson mapper used to inspect real responses without depending on a browser or internal MVC details. |
| `database`, `proxy`, `application`, `base` | Resources owned by this test run: isolated test schema, connection proxy, Spring context and random-port base URI. |
| `startAgainstIsolatedPostgresSchema()` | `@BeforeAll` creates the guarded test schema, inserts the TCP proxy between the app and PostgreSQL, then starts the application. |
| `startApplication()` | Launches `MediWishApplication` with datasource and Liquibase properties directed through the proxy and obtains the random local HTTP port. |
| `closeOnlyResourcesOwnedByThisRun()` | `@AfterAll` closes the application, proxy, isolated schema and HTTP client in nested `finally` blocks. It never stops the shared PostgreSQL service. |

## Test methods

| Method | What it proves |
| --- | --- |
| `startedApplicationHasMinimalLiveAndReadyResponsesAndActualJpaAndLiquibase()` | Both health groups return 200/`UP`; JPA is open; Liquibase is present; and the baseline changelog has actually run in the isolated schema. |
| `managementAndUnknownRoutesReturnBoundedErrorsWithoutRequestSecrets(CapturedOutput output)` | Sensitive Actuator routes, API docs, dashboard and unknown paths are denied with only `code`, `message` and `requestId`; request secrets are absent from bodies and logs. A mutating health request receives the expected 403 contract. |
| `invalidCorrelationIdIsReplacedWithoutEchoingOrLoggingIt(CapturedOutput output)` | An unsafe oversized correlation value is replaced by a safe generated ID and is absent from the response body and captured logs. |
| `concurrentPublicChecksKeepRequestCorrelationIndependent()` | Eight concurrent readiness requests retain their own request IDs and each receive the minimal `UP` response, checking MDC/request isolation. |
| `databaseLossAffectsOnlyReadinessAndServiceRecoversWithoutProcessRestart()` | Closing proxy sessions makes readiness return 503 while liveness remains 200; reconnecting the proxy lets readiness recover within the bounded polling window without restarting the application. |
| `restartKeepsExistingDataAndDoesNotReapplyMigration()` | A probe table and row survive a context restart, while Liquibase changelog count remains unchanged. |

## Helper methods

| Method | Behavior and reason |
| --- | --- |
| `scalar(String query)` | Reads one numeric result from the run-owned schema for migration/data assertions. Queries are constructed only with the generated schema and fixed test SQL. |
| `assertHealth(String group, int expectedStatus, String expectedHealth)` | Calls a health group and checks status, minimal JSON, JSON content type, no-store caching and the expected request ID. |
| `get(String path, String requestId)` | Performs a bounded GET against the random local server with a supplied correlation ID. |

## Verification

Run with the real PostgreSQL 18 test environment and the Maven `verify` lifecycle. This test is the cumulative guard: later stories must retain it and add their own feature and cross-story journeys.
