# `AuthRequestBodyLimitFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/AuthRequestBodyLimitFilterTest.java`](../../../../../../../src/test/java/bd/mediwish/web/AuthRequestBodyLimitFilterTest.java)

## Purpose

Unit test of the 16 KiB auth request limit: a body at the limit reaches the controller intact; a JSON body over it is rejected whatever `Content-Length` declares; other methods, routes and content types pass through to their normal handling.

## Verification

10 tests.

Verified 2026-09-27 on `b26f0c9` plus the Ticket 03.03 changes: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
