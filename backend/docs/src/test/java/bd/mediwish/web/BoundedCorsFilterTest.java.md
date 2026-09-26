# `BoundedCorsFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/BoundedCorsFilterTest.java`](../../../../../../../src/test/java/bd/mediwish/web/BoundedCorsFilterTest.java)

## Purpose

Unit test of `BoundedCorsFilter`: a disallowed origin gets the bounded `ACCESS_DENIED` envelope instead of Spring's text; an allowed origin continues with credentialed CORS headers; an allowed preflight is answered without reaching the application.

## Verification

3 tests.

Verified 2026-09-27 on `724b0c8`: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
