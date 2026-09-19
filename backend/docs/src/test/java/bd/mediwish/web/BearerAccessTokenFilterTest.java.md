# `BearerAccessTokenFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java`](../../../../../../src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java)

## Purpose

Tests the bearer adapter and current-user/session handoff without parsing JWTs in the test or constructing a database substitute.

## Verification

The tests cover a verified current principal, bounded invalid-bearer rejection with a Bearer challenge, and the fact that Basic headers and refresh cookies cannot authenticate `/api/user/me`.
