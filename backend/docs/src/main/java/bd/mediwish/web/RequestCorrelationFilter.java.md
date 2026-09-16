# `RequestCorrelationFilter.java`

Source: [`src/main/java/bd/mediwish/web/RequestCorrelationFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/RequestCorrelationFilter.java)

## Purpose and reasoning

`RequestCorrelationFilter` gives every request a bounded correlation ID that can be returned to the caller and placed in structured logs. It accepts a caller-supplied ID only when exactly one `X-Request-ID` value is present and it matches the safe ASCII pattern `[A-Za-z0-9_-]{1,64}`. Missing, duplicated, oversized or unsafe values receive a fresh UUID. This supports support investigations without recording medical searches, credentials, bodies or headers.

## Class and method

| Member | Behavior and use case |
| --- | --- |
| `RequestCorrelationFilter` | A Spring component ordered at highest precedence, so correlation is available to security failures and normal handlers alike. |
| `doFilterInternal(request, response, chain)` | Reads and validates the request ID, stores it as request attribute `requestId`, returns it as `X-Request-ID`, and marks the response `Cache-Control: no-store`. It puts the same value in SLF4J MDC while the chain executes. In `finally`, it logs only the response status and removes the MDC entry to prevent thread-context leakage. |

The filter uses `OncePerRequestFilter` so one logical request receives one correlation decision. Logging intentionally excludes URLs, queries, headers and bodies.

## Verification

`RequestCorrelationFilterTest` checks accepted and rejected IDs plus MDC cleanup. `HealthIT` verifies the header, error-body correlation, concurrent independence and the absence of secret request content in logs.
