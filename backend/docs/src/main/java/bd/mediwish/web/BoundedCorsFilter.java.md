# `BoundedCorsFilter.java`

Source: [`src/main/java/bd/mediwish/web/BoundedCorsFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/BoundedCorsFilter.java)

## Purpose

Small adapter around Spring's `CorsFilter` that preserves the single configured credentialed-origin policy while replacing a rejected framework response with the shared bounded API error envelope.

## Behavior

Accepted requests retain Spring's CORS headers and response body. Rejected requests return HTTP 403 through `ApiErrors`, including the request ID and `Cache-Control: no-store`, without exposing framework diagnostics, request headers or credentials. Origin parsing and allowed-origin decisions remain owned by `SecurityConfiguration`; this class does not define a second CORS policy.

## Verification

`Ticket03SecurityBoundaryTest` checks rejected-origin status, code, message, correlation header/body, no-store behavior and absence of Spring's raw CORS text. Full `AuthIT` coverage exercises the same boundary over the application context.
