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
| `app.cors.allowed-origins` | Reads explicit credentialed browser origins from `APP_CORS_ALLOWED_ORIGINS`. When unset, only an explicitly recognized `local`, `dev`, `development` or `test` profile may use the documented loopback origins; a profileless process and other hosted profiles fail startup. Wildcard origins are rejected. |
| `app.auth` | Supplies the Ticket 03 access/refresh lifetimes (`PT15M`/`P30D`), JWT issuer/audience, an environment-provided Base64 HMAC secret, an environment-provided dummy password verifier and `cookie.secure`, which defaults to true through `APP_AUTH_COOKIE_SECURE`. Local HTTP tests may explicitly override the cookie flag; hosted configuration must keep it enabled. |
| `logging` | Emits structured ECS console logs, suppresses noisy or potentially sensitive JDBC/connection health, pool, ORM and Liquibase messages, and keeps Hibernate errors visible at `ERROR`. The request filter logs only status and correlation ID. |
| `springdoc` | Disables API-doc generation by default. The compatibility test enables it temporarily to verify the optional dependency without publishing documentation. |
| `jobrunr` | Disables worker, dashboard and anonymous usage data by default. The compatibility test enables only the scheduler/storage boundary it is checking. |

`DB_HOST` defaults to `localhost` and `DB_PORT` to `5432`; database name and credentials have no source default. The normal local database is `medi_wish_dev`; integration tests override the datasource with an isolated schema in `medi_wish_test`. Tomcat's built-in `maxPostSize` is limited to container parameter/multipart parsing rather than JSON request deserialization, so the security chain adds a 16 KiB body ceiling only to the unauthenticated login and registration JSON routes before MVC reads them.

## Use cases and limits

The file supports local startup, packaged startup and health checks with the same property names. It does not configure production secrets, external providers, business features or deployment infrastructure. Those concerns belong to later feature/configuration changes and should preserve the no-detail health/error boundary.

## Verification

`HealthIT` verifies health groups, database readiness, bounded responses, recovery and migration persistence. `ConfigurationIT` proves malformed datasource settings fail without printing a password. `DependencyCompatibilityIT` verifies the profile-specific overrides remain restricted.
