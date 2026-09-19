# `ConcurrentRefreshIT.java`

Source: [`src/test/java/bd/mediwish/auth/ConcurrentRefreshIT.java`](../../../../../../src/test/java/bd/mediwish/auth/ConcurrentRefreshIT.java)

## Purpose

Exercises the refresh replay boundary over real HTTP, PostgreSQL 18 and the Liquibase-migrated run-owned schema. Two requests use the same refresh cookie and CSRF pair at the same time; the test requires one rotation, one generic 401, family revocation, and invalidation of the winner's newly issued access and refresh credentials.

## Test boundary

The class starts the application with `TestDatabase` properties, creates one unique synthetic user, obtains the CSRF nonce from the bounded bootstrap body, and cleans up only its generated schema. Java `HttpClient` sends explicit cookie, CSRF, Origin and bearer headers; credentials and token values remain local and are never logged or included in diagnostic assertions.

## Verification

Run with Failsafe using `-Dit.test=ConcurrentRefreshIT`. The test requires PostgreSQL 18 and the repository's configured test credentials; missing infrastructure is an environment block, not a reason to weaken the race assertions.
