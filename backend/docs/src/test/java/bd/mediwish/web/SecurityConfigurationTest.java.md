# `SecurityConfigurationTest.java`

Source: [`src/test/java/bd/mediwish/web/SecurityConfigurationTest.java`](../../../../../../src/test/java/bd/mediwish/web/SecurityConfigurationTest.java)

## Purpose

Tests the authentication configuration seam without starting the application. It proves password verifiers use Argon2, username lookup applies the registration normalization rule, and browser access is restricted to configured local origins, methods and headers.

## Verification

The suite checks Argon2 encode/match behavior, several whitespace/case forms of normalized shared-User lookup with persisted Customer-role authorities, and both allowed and rejected browser-origin CORS configurations.
