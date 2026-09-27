# `WebTestFixtures.java`

Source: [`src/test/java/bd/mediwish/web/WebTestFixtures.java`](../../../../../../../src/test/java/bd/mediwish/web/WebTestFixtures.java)

## Purpose

Production web components over synthetic settings, for web unit tests: `ApiErrors` over the real `messages.properties`, `SecurityConfiguration` for a secure-cookie flag and a comma-separated profile list (empty means no active profile), with `TestAuthSettings.mfa()` completing `AuthProperties`.

## Verification

Used by the web unit tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
