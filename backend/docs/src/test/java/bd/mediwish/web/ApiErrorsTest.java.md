# `ApiErrorsTest.java`

Source: [`src/test/java/bd/mediwish/web/ApiErrorsTest.java`](../../../../../../../src/test/java/bd/mediwish/web/ApiErrorsTest.java)

## Purpose and test boundary

Unit coverage of the bounded public error contract, without an application context or embedded server.

## Methods

| Member | Behavior |
| --- | --- |
| `writesOnlyTheCodeEnglishMessageAndRequestId()` | Writes `AUTHENTICATION_REQUIRED` for a request carrying a request ID, a private exception and a private query. The response is `401`, `application/json`, and exactly `code`, the English message and `requestId`; nothing private appears. |
| `leavesTheResponseOpenForTheFiltersThatWrapIt()` | Writes through a wrapper whose output stream records `close()`. The body is written and the stream is never closed, so the container completes the response only after outer filters, including the status log, have run. This guards the cause of the former intermittent empty log capture in the `*IT` `assertLogsOmitSecrets` checks. |
| `everyCodeHasAnExternalizedMessage(ApiError)` | Every `ApiError` resolves a non-blank message from the `messages` bundle. |
| `classifiesFrameworkStatuses(int, ApiError)` | `ApiError.forStatus` maps 400, 406, 413, 415 and 499 to `INVALID_REQUEST`, 401/403/404/405 to their own codes, 429 to `TOO_MANY_ATTEMPTS`, and 500, 503 and 599 to `INTERNAL_ERROR`. |
| `theErrorPageKeepsTheFrameworkStatusWithACorrelatedBoundedBody(...)` | Through standalone MockMvc with `ApiErrorController` and `RequestCorrelationFilter`, an `ERROR` dispatch of 404, 415 or 500 keeps its status; an out-of-range 200 becomes 500. Each response has `no-store`, the bounded code and a request ID equal to `X-Request-ID`, and omits the exception detail. |

## Verification

Run with the Maven unit suite (`test`). The every-code check includes the four MFA codes. This simulates the servlet `ERROR` dispatch. Over HTTP, `SignInIT` covers framework `400` and `415` answers; the embedded server's `/error` routing for `404` and `500` is not exercised over HTTP.

Verified 2026-09-27 on branch `fix-log-capture-flake` over `bef3b76`: the stream-closing test failed before the fix and passes after it. `./mvnw.cmd -o verify` passed 3 of 3 runs, `-Pcompatibility verify` passed 2 of 2, and `ProfileIT` with `SignInIT` passed 10 of 10 repeated runs. After `dev` (`9f6399c`, Ticket 06) was merged in, `./mvnw.cmd -o verify` passed 239 unit and 142 integration tests (1 skipped).
