# `RequestCorrelationFilterTest.java`

Source: [`src/test/java/bd/mediwish/web/RequestCorrelationFilterTest.java`](../../../../../../../src/test/java/bd/mediwish/web/RequestCorrelationFilterTest.java)

## Purpose and test boundary

This unit test exercises the request correlation filter with mock servlet objects and a minimal filter chain. It protects the accepted ID format, replacement behavior and cleanup of thread-local logging context without starting the application.

## Class and methods

| Member | Behavior and reason |
| --- | --- |
| `acceptsBoundedIdsAndClearsRequestContext()` | Supplies one safe `X-Request-ID`, checks the filter places it in MDC and returns it in the response, then checks MDC is empty after the chain completes. |
| `replacesMissingDuplicateAndUnsafeIds()` | Covers empty, oversized, CRLF/unsafe, non-ASCII and duplicate values; each is replaced by a response ID matching `[A-Za-z0-9_-]{1,64}` and different from the supplied value. |

Together the methods prevent header injection and cross-request MDC leakage while preserving caller IDs useful for support correlation.

## Verification

Run with the Maven unit suite (`test`). `HealthIT` additionally verifies concurrent requests and log privacy through the running server.
