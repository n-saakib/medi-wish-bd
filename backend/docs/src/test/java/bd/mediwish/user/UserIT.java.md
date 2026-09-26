# `UserIT.java`

Source: [`src/test/java/bd/mediwish/user/UserIT.java`](../../../../../../src/test/java/bd/mediwish/user/UserIT.java)

## Purpose

Exercises the shared User and Ticket 03 HTTP journeys against a real Spring application, PostgreSQL 18 and one isolated run-owned schema per test class. Each case creates a unique synthetic identity and relies on schema teardown for cleanup; no test fixture falls back to the development database.

## Covered journeys

| Scenario | Contract evidence |
| --- | --- |
| Registration and profile | Registration returns only the safe public projection with deferred mobile verification. Anonymous profile access is rejected, while a Bearer access token reaches the current profile. Response/error request IDs are server generated and bounded rather than caller echoes. |
| Caller-supplied role isolation | A registration request carrying both `role: ADMIN` and `roles: [ADMIN]` is accepted by the live JSON binding, but the persisted role set remains exactly `CUSTOMER`. |
| Refresh cookie | Login sets the scoped `MW_REFRESH` cookie with a positive `Max-Age` no greater than the configured session lifetime; the bounded CSRF bootstrap body and cookie pair enable a credentialed refresh that rotates both the access token and cookie. Cookie values are retained only in local test variables and are not asserted or printed. A deterministic adapter test covers exact remaining-family lifetime. |
| Duplicate and concurrent registration | Repeating the identical registration payload after a `201` returns bounded `409 DUPLICATE_USER`. This records the server result for an exact retry after creation; a caller retrying after an unknown first outcome would receive the duplicate result, although this test itself observes the first `201`. It is not dropped-response injection or idempotent replay. Simultaneous registrations with distinct usernames and one shared mobile produce exactly one success plus one database-backed `DUPLICATE_USER` conflict; a two-party start barrier also races case/whitespace variants of one normalized username with distinct mobiles, asserts exactly one `201` and one bounded `409`, and verifies that only the expected canonical username persists. |
| Credentialed CORS | An allowed preflight for the cookie-backed refresh route returns explicit origin, credentials, method and header permissions. |

## Test harness and boundaries

Requests use Java `HttpClient`, explicit request IDs, bearer/cookie headers and a small response-cookie parser. Assertions inspect response keys, safe projections, status, bounded error shapes and cookie attributes without logging passwords, access tokens, refresh values or other raw credentials. The suite does not add fixture endpoints or alter production behavior.

## Verification

`test-compile` passes with the repository-local Maven cache. The first real Failsafe startup was blocked by a migration/entity mismatch: the session refresh hash column was PostgreSQL `CHAR(64)` while the JPA mapping expected `VARCHAR(64)`. After that correction, constructor wiring, raw double-submit CSRF handling and the separate-origin CSRF bootstrap were fixed, and the current fresh-schema AuthIT/UserIT rerun passed all 5 tests. On 2026-09-23, `.\mvnw.cmd "-Dmaven.repo.local=D:\Web Dev\medi-wish-bd\backend\.m2\repository" "-Dit.test=UserIT" verify` passed 76 unit tests and all 4 UserIT integration tests against guarded PostgreSQL 18; the role-payload case observed HTTP 201 and persisted only `CUSTOMER`, and the concurrent shared-mobile case returned 201/409. An initial wrapper invocation without the repository-local path was blocked because Maven resolved its cache to inaccessible `C:\.m2\repository`.

After adding isolated Ticket 02 boundary tests and the normalized-username race, the focused command `.\mvnw.cmd -o '-Dmaven.repo.local=D:\Web Dev\medi-wish-bd\backend\.m2\repository' '-Dtest=UserServiceTest' '-Dit.test=UserIT' verify` passed 17 `UserServiceTest` cases and all 5 `UserIT` cases with zero failures, errors or skips; `UserIT` used the guarded PostgreSQL 18 schema and observed one registration success, one bounded conflict, and one persisted normalized user.
