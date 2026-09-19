# `AuthController.java`

Source: [`src/main/java/bd/mediwish/auth/AuthController.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthController.java)

## Purpose

Owns the `/api/auth` HTTP contract for Ticket 02 registration and Ticket 03 password sessions. It maps requests to `UserService` and `AuthenticationService`, writes only safe response projections, and delegates refresh-token handling to `RefreshCookieAdapter`.

## Routes and boundaries

- `POST /api/auth/register` preserves the Ticket 02 `201 Registered` projection and never returns a password or verifier.
- `POST /api/auth/login` accepts bounded `{identifier,password}`, returns a Bearer access-token response, and sets only the opaque refresh value as an HttpOnly cookie.
- `GET /api/auth/csrf` reads the deferred CSRF token so Spring emits `XSRF-TOKEN` and returns the same bounded non-secret nonce for a separate frontend origin to echo.
- `POST /api/auth/refresh` and `POST /api/auth/logout` read the refresh cookie and delegate rotation/revocation; the controller never hashes or parses credentials.

All responses use `Cache-Control: no-store`, preserve request correlation, and map authentication/input failures to externalized bounded errors. OTP, recovery, MFA and OAuth behavior are not represented here.

## Verification

`AuthControllerTest` covers registration compatibility, safe login responses, the separate-origin CSRF bootstrap projection, cookie attributes, invalid input, generic authentication failure, missing refresh credentials and idempotent logout clearing.
