# `ApiExceptionHandlerTest.java`

Source: [`src/test/java/bd/mediwish/web/ApiExceptionHandlerTest.java`](../../../../../../../src/test/java/bd/mediwish/web/ApiExceptionHandlerTest.java)

## Purpose

Standalone MockMvc test of `ApiExceptionHandler`: each domain failure, including `MfaCodeInvalidException` (400), `MfaEnrollmentStaleException` (409) and `TooManyAttemptsException` (429), maps to its bounded `ApiError` status and code, and unreadable JSON is an invalid request whose error does not echo the body.

## Verification

13 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
