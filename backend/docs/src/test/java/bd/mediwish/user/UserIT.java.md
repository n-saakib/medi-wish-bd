# `UserIT.java`

Source: [`src/test/java/bd/mediwish/user/UserIT.java`](../../../../../../src/test/java/bd/mediwish/user/UserIT.java)

## Purpose

Exercises the shared User and Ticket 03 HTTP journeys against a real Spring application, PostgreSQL 18 and one isolated run-owned schema per test class. Each case creates a unique synthetic identity and relies on schema teardown for cleanup; no test fixture falls back to the development database.

## Covered journeys

| Scenario | Contract evidence |
| --- | --- |
| Registration and profile | Registration returns only the safe public projection with deferred mobile verification. Anonymous profile access is rejected, while a Bearer access token reaches the current profile. |
| Refresh cookie | Login sets the scoped `MW_REFRESH` cookie; the bounded CSRF bootstrap body and cookie pair enable a credentialed refresh that rotates both the access token and cookie. Cookie values are retained only in local test variables and are not asserted or printed. |
| Duplicate and concurrent registration | A duplicate returns the bounded conflict contract, and two simultaneous registrations produce one success plus one database-backed uniqueness conflict. |
| Credentialed CORS | An allowed preflight for the cookie-backed refresh route returns explicit origin, credentials, method and header permissions. |

## Test harness and boundaries

Requests use Java `HttpClient`, explicit request IDs, bearer/cookie headers and a small response-cookie parser. Assertions inspect response keys, safe projections, status, bounded error shapes and cookie attributes without logging passwords, access tokens, refresh values or other raw credentials. The suite does not add fixture endpoints or alter production behavior.

## Verification

`test-compile` passes with the repository-local Maven cache. The first real Failsafe startup was blocked by a migration/entity mismatch: the session refresh hash column was PostgreSQL `CHAR(64)` while the JPA mapping expected `VARCHAR(64)`. After that correction, constructor wiring, raw double-submit CSRF handling and the separate-origin CSRF bootstrap were fixed, and the current fresh-schema AuthIT/UserIT rerun passed all 5 tests. The exact offline `verify` command was attempted from this tree but is blocked before test execution because the repository-local cache lacks `maven-jar-plugin:3.5.1`.
