# `BearerAccessTokenFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java`](../../../../../../src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java)

## Purpose

Tests the bearer adapter and current-user/session handoff without parsing JWTs in the test or constructing a database substitute.

## Verification

The tests cover a verified current principal, bounded invalid-bearer rejection with a Bearer challenge and server-generated request ID, generic `500 INTERNAL_ERROR` handling for persistence, data-access and transaction failures during current-user loading, the fact that Basic headers and refresh cookies cannot authenticate `/api/user/me`, and that an `access_token` query parameter or unrelated `X-Access-Token` header cannot authenticate that profile route. An oversized bearer value on a public auth route is also ignored by this protected-route filter.
