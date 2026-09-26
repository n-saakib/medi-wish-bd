# `RequestCorrelationFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/RequestCorrelationFilterTest.java`](../../../../../../../src/test/java/bd/mediwish/web/RequestCorrelationFilterTest.java)

## Purpose and test boundary

This unit test exercises the request correlation filter with mock servlet objects and a minimal filter chain. It protects server-generated UUID correlation and cleanup of thread-local logging context without starting the application.

## Class and methods

| Member | Behavior and reason |
| --- | --- |
| `defersLogUntilErrorDispatchAndReusesRequestId(CapturedOutput output)` | Simulates an uncaught REQUEST dispatch followed by a separate ERROR dispatch. It requires no premature status event, then one correlated final 500 event with the same response header and request attribute ID, and verifies MDC cleanup on both dispatches. |
| `nestedErrorDispatchLogsOneFinalStatus(CapturedOutput output)` | Simulates a nested ERROR dispatch and requires a single final 500 status event rather than duplicate outer/nested events. |
| `replacesCallerSuppliedIdAndClearsRequestContext()` | Supplies a safe-looking `X-Request-ID`, proves the filter instead uses one UUID shared exactly by MDC, the request attribute and response header, then checks MDC is empty after the chain completes. |
| `replacesMissingDuplicateAndUnsafeIds()` | Covers no header, empty, oversized, CRLF/unsafe, non-ASCII and duplicate values; each receives a fresh UUID rather than a caller value. |

Together the methods prevent untrusted caller IDs from entering response/log correlation, prevent cross-request MDC leakage, and keep status logs aligned with completed servlet error dispatches.

## Verification

Run with the Maven unit suite (`test`). `HealthIT` additionally verifies concurrent requests and log privacy through the running server.
