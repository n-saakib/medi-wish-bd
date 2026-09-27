# `BearerAccessTokenFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java`](../../../../../../../src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java)

## Purpose

Unit test of the Bearer adapter over a mocked `CurrentUserAuthentication`: a verified Bearer authenticates the whole `CurrentUser` as principal with exactly the authorities it was granted; an invalid Bearer or several `Authorization` values get 401 with a Bearer challenge; missing or Basic authorization continues unauthenticated; a token in `Proxy-Authorization`, `X-Auth-Token`, an `access_token` cookie or `access_token`/`token` parameters is never read; public routes never read the Bearer; and a persistence or transaction failure is a bounded `INTERNAL_ERROR` without its detail.

## Verification

7 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
