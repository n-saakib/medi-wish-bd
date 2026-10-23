# `application.yaml`

Source: [`src/main/resources/application.yaml`](../../../../src/main/resources/application.yaml)

## Purpose and reasoning

This file contains safe runtime defaults and environment-backed connection settings. Secrets are required from the process environment; they are not stored in source control. YAML keeps related Spring settings grouped by subsystem and makes the operational boundary visible without adding a custom configuration layer.

## Configuration map

| Section | Behavior and reason |
| --- | --- |
| `spring.application` | Names the application `medi-wish`; the startup banner is disabled for quieter logs. |
| `spring.datasource` | Builds a PostgreSQL URL from `DB_HOST`, `DB_PORT`, and required `DB_NAME`, with a two-second connect limit and a three-second `socketTimeout`. The socket timeout applies to every statement, not only health checks, so no query may run longer than three seconds; long-running work needs its own deliberate configuration. `DB_USERNAME` and `DB_PASSWORD` are required environment values. Hikari is bounded to four connections, allows zero idle connections, and fails acquisition/validation after one second. These limits keep a small launch deployment responsive when the database is unavailable. |
| `spring.jpa` | Disables open-in-view and sets Hibernate `ddl-auto` to `validate`. JPA can validate the schema, while Liquibase remains the only schema owner. |
| `spring.liquibase` | Runs `classpath:db/changelog/db.changelog-master.yaml` at startup so migrations are versioned and repeatable. |
| `management` | Exposes only the health endpoint, disables endpoint discovery, returns read-only health data, hides details/components, and defines minimal liveness/readiness groups. Liveness checks process state; readiness also includes the database. |
| `server.max-http-request-header-size` | Caps request headers at 16 KB to bound input handling. |
| `app.cors.allowed-origins` | Reads explicit credentialed browser origins from `APP_CORS_ALLOWED_ORIGINS`. When unset, only a process whose active profiles are all `local` or `test` may use the loopback frontend origins; a profileless process and any other profile fail startup. Wildcard origins are rejected. |
| `app.auth` | Binds `AuthProperties`: access/refresh lifetimes (`PT15M`/`P30D`, each at least one second), JWT issuer/audience, the Base64 HMAC secret from `APP_AUTH_JWT_SECRET` (validated by `JwtAccessTokenCodec`) and `cookie.secure`, which defaults to true through `APP_AUTH_COOKIE_SECURE`. Only `local`/`test` processes may set the cookie flag to false. There is no dummy-verifier setting. `app.auth.mfa` holds the staff MFA settings: issuer `Medi Wish`, `secret-key` from `APP_AUTH_MFA_SECRET_KEY` (Base64 of exactly 32 bytes, validated by `MfaSecretCipher`), `restricted-session-lifetime` and `enrollment-lifetime` `PT10M`, `max-failed-attempts` 5, `attempt-window` and `lockout` `PT15M`. |
| `app.provisioning.first-admin-username` | Empty by default. Set only on the one-off first-Admin command, together with `spring.main.web-application-type=none`; `FirstAdminProvisioning` refuses to run in a serving process. |
| `logging` | Emits structured ECS console logs, suppresses noisy or potentially sensitive JDBC/connection health, pool, ORM and Liquibase messages, and keeps Hibernate errors visible at `ERROR`. The request filter logs only status and correlation ID. |
| `springdoc` | Disables API-doc generation by default. The compatibility test enables it temporarily to verify the optional dependency without publishing documentation. |
| `jobrunr` | Disables worker, dashboard and anonymous usage data by default. The compatibility test enables only the scheduler/storage boundary it is checking. |

`DB_HOST` defaults to `localhost` and `DB_PORT` to `5432`; database name and credentials have no source default. The normal local database is `medi_wish_dev`; integration tests override the datasource with an isolated schema in `medi_wish_test`. Tomcat's built-in `maxPostSize` is limited to container parameter/multipart parsing rather than JSON request deserialization, so the security chain adds a 16 KiB body ceiling to the login and registration JSON routes and the staff MFA routes before MVC reads them. No `server.error.include-*` settings are needed: `ApiErrorController` owns `/error` and renders only the bounded envelope, and Spring Boot's own defaults already omit messages, binding errors, stack traces and exception names.

## Use cases and limits

The file supports local startup, packaged startup and health checks with the same property names. It does not configure production secrets, external providers, business features or deployment infrastructure. Those concerns belong to later feature/configuration changes and should preserve the no-detail health/error boundary.

## Verification

`HealthIT` verifies health groups, database readiness, bounded responses, recovery and migration persistence. `ConfigurationIT` proves malformed datasource settings fail without printing a password. `DependencyCompatibilityIT` verifies the profile-specific overrides remain restricted. `AuthPropertiesTest` and `MfaSecretCipherTest` cover the MFA settings, and `FirstAdminProvisioningIT` the provisioning property.

Ticket 15 configures servlet multipart at 3 MB file / 4 MB request and Tomcat swallow at 8 MB so oversized and unauthorized uploads yield readable bounded errors. Storage provider/root/namespace are mandatory runtime settings. The local adapter is confined to exclusively local/test serving profiles.
app.addresses.change-limits.per-week and per-month configure successful address changes (5 and 10). Both values must be present integers at least one; service construction rejects invalid limits. Limits change through configuration and restart, with no schema change.

## Ticket 05 recovery

`app.auth.recovery` supplies the accepted code, issue, address and password-check limits and requires APP_AUTH_RECOVERY_CODE_KEY. `app.mail.transport` defaults to disabled; APP_MAIL_CAPTURE_DIRECTORY configures controlled directory capture, while sender identity and configuration belong to the deferred SES adapter.

`app.notification.security.adapter` reads APP_NOTIFICATION_SECURITY_ADAPTER with disabled as the default; timeout reads APP_NOTIFICATION_SECURITY_TIMEOUT with PT5S as the default. NotificationProperties rejects unknown adapters and timeouts outside one to five seconds. Capture delivery is confined to exclusively local/test profiles; this configuration supplies no real SMS provider.
