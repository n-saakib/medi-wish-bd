# `BearerAccessTokenFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java`](../../../../../../../src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java)

## Purpose

Unit test of the Bearer adapter over a mocked `CurrentUserAuthentication`: a verified Bearer authenticates the current `UserProfile` with its persisted roles; an invalid Bearer or several `Authorization` values get 401 with a Bearer challenge; missing or Basic authorization continues unauthenticated; a token in `Proxy-Authorization`, `X-Auth-Token`, an `access_token` cookie or `access_token`/`token` parameters is never read; public routes never read the Bearer; and a persistence or transaction failure is a bounded `INTERNAL_ERROR` without its detail.

## Verification

7 tests.

Verified 2026-09-27 on `b26f0c9` plus the Ticket 03.03 changes: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
