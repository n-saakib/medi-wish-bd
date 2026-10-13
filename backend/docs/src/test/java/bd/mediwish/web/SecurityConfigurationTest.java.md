# `SecurityConfigurationTest.java`

Source: [SecurityConfigurationTest.java](../../../../../../../src/test/java/bd/mediwish/web/SecurityConfigurationTest.java)

## Purpose

Unit tests for `SecurityConfiguration`, built through `WebTestFixtures` without starting the application or PostgreSQL.

## Verification

Insecure auth cookies fail startup unless every active profile is `local` or `test` (no profile, `production`, `staging` and mixed lists fail); Secure cookies are accepted under any profile. CORS is credentialed and limited to the configured origins, methods `GET`, `POST`, `PUT`, `DELETE`, `HEAD`, `OPTIONS` and headers `Authorization`, `Content-Type`, `X-XSRF-TOKEN`; only a local profile falls back to the loopback frontend origins, and a wildcard origin fails. With Secure cookies and no active profile, the `XSRF-TOKEN` cookie is Secure, not HttpOnly, scoped to `/api` and `SameSite=Lax`.

Every profile read and command must also match PROTECTED_ROUTES so Bearer authentication runs.
Focused settings/security tests: insecure cookies only for exclusively local/test profiles, hosted explicit credentialed CORS including PUT, allowed headers, no wildcard, local fallback and CSRF cookie attributes. The hierarchy gives ADMIN every lower role while an MFA authority grants none. Administrative search/role commands share Bearer protection and body-limit matchers; refresh stays outside that exemption.

The catalog PUT wildcard matches exactly one segment and never captures pricing; pricing and catalog commands belong to the protected Bearer command matchers. CatalogSecurityTest executes the production security chain for actor admission and body-limit ordering.

Ticket 16 pins protected read/command membership, Bearer command exemptions, exact end wildcard matching, and the anonymous product-price matcher outside PROTECTED_ROUTES.
