# `RequestCorrelationFilter.java`

Source: [`src/main/java/bd/mediwish/web/RequestCorrelationFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/RequestCorrelationFilter.java)

## Purpose

Package-private servlet filter ordered at highest precedence, so it wraps the security chain, controllers and the error page. It is the only writer of `X-Request-ID` and `Cache-Control: no-store`.

## Behavior

| Member | Behavior |
| --- | --- |
| `doFilterInternal(request, response, chain)` | Generates a UUID for the logical request (or reuses the one already stored in the `requestId` attribute), writes it as `X-Request-ID` with `Cache-Control: no-store` before the chain runs, and puts it in the SLF4J MDC while the chain executes. After a normal completion it logs one `HTTP response status=<status>` event; an exception unwinding the request does not log a premature status. The previous MDC value is restored. |
| `doFilterNestedErrorDispatch(...)` | Re-applies the same ID and headers during servlet ERROR dispatches and logs the final status once. |

A caller-supplied `X-Request-ID` is never used, so untrusted values are not reflected or logged. `ApiErrors` reads the same attribute for the envelope's `requestId`. Logging excludes URLs, queries, headers and bodies.

## Verification

`RequestCorrelationFilterTest` covers caller-ID replacement, header, attribute and MDC identity, MDC cleanup, separate and nested ERROR dispatches, and one final status event. `HealthIT` and every auth integration test (through `TestApplication.send`) verify correlation and log privacy over real HTTP.
