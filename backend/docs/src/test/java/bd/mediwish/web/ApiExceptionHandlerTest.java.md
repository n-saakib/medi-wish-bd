# `ApiExceptionHandlerTest.java`

Source: [`src/test/java/bd/mediwish/web/ApiExceptionHandlerTest.java`](../../../../../../../src/test/java/bd/mediwish/web/ApiExceptionHandlerTest.java)

## Purpose

Standalone MockMvc test of `ApiExceptionHandler`: each domain failure maps to its bounded `ApiError` status and code, and unreadable JSON is an invalid request whose error does not echo the body.

## Verification

10 tests.

Verified 2026-09-27 on `ed1e006`: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
