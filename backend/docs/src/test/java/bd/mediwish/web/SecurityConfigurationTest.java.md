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
Ticket 12 verifies collection reads and collection/item commands are Bearer-protected, only commands are CSRF-exempt, and item wildcards consume exactly one path segment.

Ticket 09 checks both recovery and backup-code regeneration are explicit POST members of `MFA_ROUTES` and `PROTECTED_ROUTES`; GET and extra path segments do not match. All three restricted authorities (`MFA_ENROLLMENT`, `MFA_CHALLENGE`, `MFA_REPLACEMENT`) remain outside the role hierarchy. `StaffMfaSecurityTest` executes their authorization rules through the production chain.

T4 verification on 2026-10-19, working tree over `13968d1`: `.\mvnw.cmd -o test -Dtest=StaffMfaControllerTest,StaffMfaSecurityTest,SecurityConfigurationTest` passed 39 focused tests; `.\mvnw.cmd -o test` passed all 1,033 backend units with zero failures/errors/skips at 15:00:14 +06:00. Before security wiring, the production-chain/matcher gate had 10 expected failures in 31 tests. A separate controlled controller mutation had 2 expected failures in 8 tests for relaxed exact-key validation and null contactNotice serialization. Exact original controller bytes were restored before the full gate. These targeted faults are distinguished from missing-method compile-red; real HTTP/PostgreSQL/API acceptance is recorded separately.

Ticket 17 pins exact GET-only public catalog matcher coverage, separation from the price, staff and deeper paths, and exclusion from Bearer-protected routes.
