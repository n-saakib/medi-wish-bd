# `TestApplication.java`

Source: [`src/test/java/bd/mediwish/testsupport/TestApplication.java`](../../../../../../../src/test/java/bd/mediwish/testsupport/TestApplication.java)

## Purpose

One running application on a random port and its HTTP client. `launch(properties, testConfigurations...)` runs `MediWishApplication` plus any test configuration under the local `test` profile, with the given properties taking precedence; `HealthIT`, `LegacyUserMigrationIT` and `DependencyCompatibilityIT` use it directly. When the properties set `spring.main.web-application-type` to `none`, it calls `setWebApplicationType(NONE)` on the launcher, because the type is chosen before initializers add the properties; `FirstAdminProvisioningIT` uses this to run the operator command. `start` wraps it, `restart()` reruns it on the same schema, and `bean` and `uri` expose the context.

`send(method, path, headers, body)` checks the contract every route shares: `Cache-Control: no-store` and one server-generated UUID `X-Request-ID` that never echoes the caller's value (a random one is sent when the caller gives none). Its public `UUID_PATTERN` is also the request-ID pattern the web unit tests match.

## Verification

Used by every auth integration test through `AuthApi`.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests. The integration tests that use it passed in the targeted run.


## Ticket 05 recovery

Profiled test startup defaults `app.mail.transport` to `memory` without overriding an explicit adapter choice. The capture adapter is scoped to the application context and used by recovery journeys.
