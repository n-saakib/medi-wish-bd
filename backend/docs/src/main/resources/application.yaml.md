# `application.yaml`

Source: [`src/main/resources/application.yaml`](../../../../src/main/resources/application.yaml)

## Purpose and reasoning

This file contains safe runtime defaults and environment-backed connection settings. Secrets are required from the process environment; they are not stored in source control. YAML keeps related Spring settings grouped by subsystem and makes the operational boundary visible without adding a custom configuration layer.

## Configuration map

| Section | Behavior and reason |
| --- | --- |
| `spring.application` | Names the application `medi-wish`; the startup banner is disabled for quieter logs. |
| `spring.datasource` | Builds a PostgreSQL URL from `DB_HOST`, `DB_PORT`, and required `DB_NAME`, with two-second connect and three-second socket limits. `DB_USERNAME` and `DB_PASSWORD` are required environment values. Hikari is bounded to four connections, allows zero idle connections, and fails acquisition/validation after one second. These limits keep a small launch deployment responsive when the database is unavailable. |
| `spring.jpa` | Disables open-in-view and sets Hibernate `ddl-auto` to `validate`. JPA can validate the schema, while Liquibase remains the only schema owner. |
| `spring.liquibase` | Runs `classpath:db/changelog/db.changelog-master.yaml` at startup so migrations are versioned and repeatable. |
| `management` | Exposes only the health endpoint, disables endpoint discovery, returns read-only health data, hides details/components, and defines minimal liveness/readiness groups. Liveness checks process state; readiness also includes the database. |
| `server.error` | Omits messages, binding details, stack traces and exception names from framework errors. This supports the bounded `ApiErrors` contract. |
| `server.max-http-request-header-size` | Caps request headers at 16 KB to bound input handling. |
| `app.cors.allowed-origins` | Allows only configured frontend origins to call the User API from a browser. The default is `http://127.0.0.1:3000,http://localhost:3000`; deployments must provide an explicit `APP_CORS_ALLOWED_ORIGINS` value. |
| `logging` | Emits structured ECS console logs, suppresses noisy or potentially sensitive JDBC/connection health, pool, ORM and Liquibase messages, and keeps Hibernate errors visible at `ERROR`. The request filter logs only status and correlation ID. |
| `springdoc` | Disables API-doc generation by default. The compatibility test enables it temporarily to verify the optional dependency without publishing documentation. |
| `jobrunr` | Disables worker, dashboard and anonymous usage data by default. The compatibility test enables only the scheduler/storage boundary it is checking. |

`DB_HOST` defaults to `localhost` and `DB_PORT` to `5432`; database name and credentials have no source default. The normal local database is `medi_wish_dev`; integration tests override the datasource with an isolated schema in `medi_wish_test`.

## Use cases and limits

The file supports local startup, packaged startup and health checks with the same property names. It does not configure production secrets, external providers, business features or deployment infrastructure. Those concerns belong to later feature/configuration changes and should preserve the no-detail health/error boundary.

## Verification

`HealthIT` verifies health groups, database readiness, bounded responses, recovery and migration persistence. `ConfigurationIT` proves malformed datasource settings fail without printing a password. `DependencyCompatibilityIT` verifies the profile-specific overrides remain restricted.
