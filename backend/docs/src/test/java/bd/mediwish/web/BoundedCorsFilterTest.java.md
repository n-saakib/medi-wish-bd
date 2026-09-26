# `BoundedCorsFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/BoundedCorsFilterTest.java`](../../../../../../../src/test/java/bd/mediwish/web/BoundedCorsFilterTest.java)

## Purpose

Unit test of `BoundedCorsFilter`: a disallowed origin gets the bounded `ACCESS_DENIED` envelope instead of Spring's text; an allowed origin continues with credentialed CORS headers; an allowed preflight is answered without reaching the application.

## Verification

3 tests.

Verified 2026-09-26 on `45cbc7e` plus the uncommitted T4 worktree: `./mvnw.cmd -o verify` passed 168 unit and 105 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 168 and 105 with no skip.
