# `BearerAccessTokenFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java`](../../../../../../../src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java)

## Purpose

Unit test of the Bearer adapter over a mocked `CurrentUserAuthentication`: a verified Bearer authenticates the current `UserProfile` with its persisted roles; an invalid Bearer or several `Authorization` values get 401 with a Bearer challenge; missing or Basic authorization continues unauthenticated; a token in `Proxy-Authorization`, `X-Auth-Token`, an `access_token` cookie or `access_token`/`token` parameters is never read; public routes never read the Bearer; and a persistence or transaction failure is a bounded `INTERNAL_ERROR` without its detail.

## Verification

7 tests.

Verified 2026-09-26 on `45cbc7e` plus the uncommitted T4 worktree: `./mvnw.cmd -o verify` passed 168 unit and 105 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 168 and 105 with no skip.
