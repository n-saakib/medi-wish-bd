# `ConcurrentRefreshIT.java`

Source: [`src/test/java/bd/mediwish/auth/ConcurrentRefreshIT.java`](../../../../../../src/test/java/bd/mediwish/auth/ConcurrentRefreshIT.java)

## Purpose

Exercises refresh-cookie and session-race boundaries over real HTTP, PostgreSQL 18 and the Liquibase-migrated run-owned schema. Coverage includes simultaneous refresh replay and logout racing a refresh with the same credential.

## Covered journeys

- Two simultaneous refreshes with one cookie produce one rotation and one generic 401; replay revokes the family and invalidates the winner's newly issued access and refresh credentials.
- Blank, truncated, altered and valid-shaped guessed refresh values, plus duplicate identical or conflicting `MW_REFRESH` cookies, all produce the same bounded `401 AUTHENTICATION_REQUIRED` without issuing a replacement refresh cookie. The original valid cookie remains usable after these failures.
- A CSRF-protected logout racing refresh may linearize before or after rotation. Logout must return 204 and clear its cookie; after both requests, the family is revoked, no more than one new generation exists, only one session row exists, and any access/refresh credentials returned by the racing refresh are unusable.

## Test boundary

The class starts the application with `TestDatabase` properties, creates one unique synthetic user, obtains the CSRF nonce from the bounded bootstrap body, and cleans up only its generated schema. Java `HttpClient` sends explicit cookie, CSRF, Origin and bearer headers; credentials and token values remain local and are never logged or included in diagnostic assertions.

## Verification

### Current cumulative verification — 2026-09-25 17:08 +06

Default backend `verify` passed all 35 PostgreSQL integration tests with one expected compatibility skip; `-Pcompatibility verify` passed all 35 with no skips. `ConcurrentRefreshIT` passed 3/3, including a random 43-character URL-safe refresh-cookie guess rejected with the same bounded 401 as malformed/truncated/altered/duplicate values and no replacement cookie; the original valid cookie remained usable. Runs used the restricted runner on isolated PostgreSQL 18 and removed the temporary role and all run-owned schemas afterward.

### Historical verification (superseded)

On 2026-09-24 at 03:38 +06:00, `.\mvnw.cmd -o "-Dmaven.repo.local=D:\Web Dev\medi-wish-bd\backend\.m2\repository" test-compile` compiled all 29 test sources successfully against `HEAD eb2f92d` with the current worktree changes; `.\mvnw.cmd -o "-Dmaven.repo.local=D:\Web Dev\medi-wish-bd\backend\.m2\repository" "-Dtest=AuthControllerTest" test` passed 6/6 DB-free focused tests. `ConcurrentRefreshIT` was not executed: the configured integration-test database role is a superuser, and the guarded test harness blocks setup before schema changes. After configuring an approved non-superuser test role, run `.\mvnw.cmd -o "-Dmaven.repo.local=D:\Web Dev\medi-wish-bd\backend\.m2\repository" "-Dit.test=ConcurrentRefreshIT" verify`; do not weaken the guard.
