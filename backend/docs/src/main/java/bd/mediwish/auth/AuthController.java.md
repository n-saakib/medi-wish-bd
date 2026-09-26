# `AuthController.java`

Source: [`src/main/java/bd/mediwish/auth/AuthController.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthController.java)

## Purpose

Owns the `/api/auth` HTTP contract for Ticket 02 registration and Ticket 03 password sessions. It maps requests to `UserService` and `AuthenticationService`, writes only safe response projections, and delegates refresh-token handling to `RefreshCookieAdapter`.

## Routes and boundaries

- `POST /api/auth/register` preserves the Ticket 02 `201 Registered` projection and never returns a password or verifier.
- `POST /api/auth/login` accepts bounded `{identifier,password}`, returns a Bearer access-token response, and sets only the opaque refresh value as an HttpOnly cookie bounded by the session family's expiry.
- `GET /api/auth/csrf` reads the deferred CSRF token so Spring emits `XSRF-TOKEN` and returns the same bounded non-secret nonce for a separate frontend origin to echo.
- `POST /api/auth/refresh` reads exactly one refresh cookie, delegates rotation and sets the rotated value with `Max-Age` limited to the unchanged session-family expiry. `POST /api/auth/logout` passes each distinct, bounded refresh-cookie value to the application service for revocation before clearing the cookie; the controller never hashes or parses credentials.

All responses use `Cache-Control: no-store`, preserve request correlation, and map authentication/input failures to externalized bounded errors. OTP, recovery, MFA and OAuth behavior are not represented here.

Persistence and transaction failures from authentication endpoints are translated to the same bounded `500 INTERNAL_ERROR` envelope. The controller does not log exception details; the refresh and multi-session logout PostgreSQL commit-failure integration cases verify synthetic database messages are absent from both responses and captured ECS output.

## Verification

`AuthControllerTest` covers registration compatibility, safe login responses, the separate-origin CSRF bootstrap projection, cookie attributes, invalid input, generic authentication failure, missing refresh credentials and idempotent logout clearing.
