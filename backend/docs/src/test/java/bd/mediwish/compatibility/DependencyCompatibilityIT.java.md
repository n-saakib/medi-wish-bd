# `DependencyCompatibilityIT.java`

Source: [`src/test/java/bd/mediwish/compatibility/DependencyCompatibilityIT.java`](../../../../../../../src/test/java/bd/mediwish/compatibility/DependencyCompatibilityIT.java)

## Purpose and test boundary

This optional integration test is enabled only when the `compatibility` Maven profile supplies both JobRunr and springdoc. It proves that the selected Boot 4 starter versions can load alongside the application, use SQL storage and generate an internal OpenAPI model without enabling workers, dashboards, telemetry or a public documentation endpoint. It does not prove business jobs, transaction joining or provider behavior.

The test uses `TestDatabase` and a unique schema in real PostgreSQL 18. Restart assertions protect Liquibase history and optional integration state from being treated as a one-start-only success.

## Class members and methods

| Member | Behavior and reason |
| --- | --- |
| `SCHEDULER`, `STORAGE`, `OPEN_API` | Fully qualified optional class names used for presence checks and reflective assertions, allowing the default build to compile without these profile-only libraries. |
| `compatibilityDependenciesPresent()` | Checks that JobRunr's scheduler and springdoc's OpenAPI service are present on the test classpath. JUnit skips the class when the profile is inactive. |
| `optionalIntegrationsStartAndRestartAgainstRealPostgresWithoutExposingInternals()` | Creates an isolated database schema, starts the application, verifies beans/restricted HTTP behavior, records migrations and confirms no jobs are queued; repeats after restart and requires identical migrations and no jobs. |
| `start(TestDatabase database)` | Starts the application through `TestApplication.launch` with the test datasource (whose properties already keep JobRunr's tables in the run's schema), JobRunr SQL scheduler enabled, worker/dashboard/anonymous telemetry disabled, and springdoc API docs enabled but Swagger UI disabled. |
| `verifyBeansAndRestrictedBehavior(context)` | Confirms JPA and Liquibase are present, JobRunr uses SQL storage, workers and dashboard beans are absent, springdoc builds an OpenAPI model, anonymous data usage is false, and `/v3/api-docs` gets the bounded 401 `AUTHENTICATION_REQUIRED` envelope without exposing an OpenAPI document. |
| `migrations(TestDatabase database)` | Reads ordered Liquibase change identifiers, authors, filenames and checksums from the run-owned schema for restart comparison. |
| `assertNoQueuedJobs(TestDatabase database)` | Counts JobRunr jobs in the isolated schema and requires zero rows because this compatibility boundary does not enqueue work. |
| `quotedSchema(TestDatabase database)` | Revalidates the generated schema format before quoting it for SQL, preventing this test helper from targeting an arbitrary schema. |

## Verification

Run with `.\backend\mvnw.cmd -f backend/pom.xml -Pcompatibility verify` after loading test database settings. The class is tagged `integration` and `compatibility`.

Verified 2026-09-26 on `45cbc7e` plus the uncommitted T4 worktree: `./mvnw.cmd -o verify` passed 168 unit and 105 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 168 and 105 with no skip.
