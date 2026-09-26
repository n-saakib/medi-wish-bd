# `RequestCorrelationFilter.java`

Source: [`src/main/java/bd/mediwish/web/RequestCorrelationFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/RequestCorrelationFilter.java)

## Purpose and reasoning

`RequestCorrelationFilter` generates a fresh UUID for each logical request and reuses it during a servlet ERROR dispatch. It never uses a caller-supplied `X-Request-ID`, so untrusted identifiers cannot be reflected to clients or copied into ECS structured output. The generated value remains bounded and useful for support correlation without recording medical searches, credentials, bodies or headers.

## Class and method

| Member | Behavior and use case |
| --- | --- |
| `RequestCorrelationFilter` | A Spring component ordered at highest precedence, so correlation is available to security failures and normal handlers alike. |
| `doFilterInternal(request, response, chain)` | Generates or reuses the request-scoped UUID, returns it as `X-Request-ID`, and marks the response `Cache-Control: no-store`. The same value is put in SLF4J MDC while the chain executes, allowing bounded error bodies and structured output to correlate with the response. It logs status only after a dispatch completes normally; an exception unwinding the original request does not prematurely log a default 200. |

The filter uses `OncePerRequestFilter` for normal and ERROR dispatches, including nested ERROR dispatches. It re-applies the same response correlation headers, logs one completed status event per logical request, and restores the prior MDC value to prevent thread-context leakage. Logging intentionally excludes URLs, queries, headers and bodies.

## Verification

`RequestCorrelationFilterTest` checks caller-ID replacement, missing/duplicate/unsafe input, exact header/attribute/MDC identity, MDC cleanup, separate and nested ERROR dispatches, and one final 500 event without an earlier 200. `AuthIT` also asserts that its real commit-failure response and captured ECS status event share the server-generated request ID. `HealthIT` verifies bounded error correlation, concurrent independence and the absence of request secrets in captured logs.
