# `TestApplication.java`

Source: [`src/test/java/bd/mediwish/testsupport/TestApplication.java`](../../../../../../../src/test/java/bd/mediwish/testsupport/TestApplication.java)

## Purpose

One running application on a random port and its HTTP client. `launch(properties, testConfigurations...)` runs `MediWishApplication` plus any test configuration under the local `test` profile, with the given properties taking precedence; `HealthIT`, `LegacyUserMigrationIT` and `DependencyCompatibilityIT` use it directly. `start` wraps it, `restart()` reruns it on the same schema, and `bean` and `uri` expose the context.

`send(method, path, headers, body)` checks the contract every route shares: `Cache-Control: no-store` and one server-generated UUID `X-Request-ID` that never echoes the caller's value (a random one is sent when the caller gives none). Its public `UUID_PATTERN` is also the request-ID pattern the web unit tests match.

## Verification

Used by every auth integration test through `AuthApi`.

Verified 2026-09-27 on `b26f0c9` plus the Ticket 03.03 changes: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
