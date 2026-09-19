# `SecurityConfigurationTest.java`

Source: [`src/test/java/bd/mediwish/web/SecurityConfigurationTest.java`](../../../../../../src/test/java/bd/mediwish/web/SecurityConfigurationTest.java)

## Purpose

Tests the T4 Spring Security configuration without starting the application or requiring PostgreSQL. It protects the public seams that are easy to regress while the full route journey remains owned by later integration work.

## Verification

The suite covers Argon2 password verification, explicit credentialed CORS headers/origins, wildcard-origin rejection, non-HttpOnly `/api`-scoped `XSRF-TOKEN` cookie attributes including SameSite, fail-closed Base64 HMAC/dummy-verifier startup validation, and production-profile rejection of insecure auth cookies.
