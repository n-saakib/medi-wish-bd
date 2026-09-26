# `BoundedCorsFilter.java`

Source: [`src/main/java/bd/mediwish/web/BoundedCorsFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/BoundedCorsFilter.java)

## Purpose

Package-private `CorsFilter` that keeps Spring's CORS decisions from `SecurityConfiguration.corsConfigurationSource` while replacing Spring's rejection text with the bounded envelope. `SecurityConfiguration` constructs it before `SecurityContextHolderFilter`; it is not a Spring bean and defines no policy of its own.

## Behavior

Its processor runs Spring's `DefaultCorsProcessor` against a buffered response. An accepted request keeps Spring's CORS headers and body; an allowed preflight is answered without reaching the application. A rejected request, if the response is not yet committed, has the buffer discarded and receives `403 ACCESS_DENIED` through `ApiErrors.write`, without framework text, request headers or credentials.

## Verification

`BoundedCorsFilterTest` covers the disallowed-origin envelope, credentialed CORS headers for an allowed origin and an allowed preflight. `SessionIT` covers the boundary with the full application context.
