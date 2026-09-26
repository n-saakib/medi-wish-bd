# `SecurityConfigurationTest.java`

Source: [`src/test/java/bd/mediwish/web/SecurityConfigurationTest.java`](../../../../../../src/test/java/bd/mediwish/web/SecurityConfigurationTest.java)

## Purpose

Tests the T4 Spring Security configuration without starting the application or requiring PostgreSQL. It protects the public seams that are easy to regress while the full route journey remains owned by later integration work.

## Verification

The suite covers ADR-0019 Argon2id encoding and verification of Ticket 02's legacy hashes, explicit credentialed CORS headers/origins, wildcard-origin rejection, loopback fallback only for explicit local/dev/test profiles, fail-closed behavior for absent, blank, whitespace-only and delimiter-only profiles, non-HttpOnly `/api`-scoped `XSRF-TOKEN` cookie attributes including SameSite, Base64 HMAC/dummy-verifier startup validation, rejection of null/zero/negative/sub-second access lifetimes, acceptance of a ten-year value without imposing a product cap, rejection of access lifetimes outside JWT `Date` representation and refresh lifetimes outside PostgreSQL's timestamp range, and hosted rejection of insecure auth cookies. A minimal Spring application-context startup test captures invalid JWT/dummy-verifier configuration failures and asserts the synthetic values are absent from emitted logs.
