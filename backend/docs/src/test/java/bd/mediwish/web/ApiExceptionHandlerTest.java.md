# `ApiExceptionHandlerTest.java`

Source: [`src/test/java/bd/mediwish/web/ApiExceptionHandlerTest.java`](../../../../../../../src/test/java/bd/mediwish/web/ApiExceptionHandlerTest.java)

## Purpose

Standalone MockMvc test of `ApiExceptionHandler`: each domain failure maps to its bounded `ApiError` status and code, and unreadable JSON is an invalid request whose error does not echo the body.

## Verification

10 tests.

Verified 2026-09-26 on `45cbc7e` plus the uncommitted T4 worktree: `./mvnw.cmd -o verify` passed 168 unit and 105 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 168 and 105 with no skip.
