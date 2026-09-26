# `AuthController.java`

Source: [`src/main/java/bd/mediwish/auth/AuthController.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthController.java)

## Purpose

Package-private HTTP adapter for `/api/auth`: registration and the password-session operations. It maps requests to `UserService` and `AuthenticationService`, returns safe projections and delegates every cookie read or write to `RefreshCookieAdapter`. It never hashes, parses or logs credentials.

## Routes

| Route | Behavior |
| --- | --- |
| `POST /register` | Calls `UserService.register` and returns `201` `Registered{username, mobile, email, mobileVerificationDeferred: true}`; no password or verifier is returned. |
| `POST /login` | Rejects a blank or missing field, an identifier over 320 characters or a password over `UserService.MAX_PASSWORD_LENGTH` with `InvalidRequestException` before authenticating. Otherwise returns `SessionResponse{accessToken, tokenType: "Bearer", expiresIn, user}` (`user` is a `UserProfile`) and sets the refresh cookie to the session's absolute expiry. |
| `GET /csrf` | Reads the deferred CSRF token so Spring emits `XSRF-TOKEN`, and returns `{csrfToken}` so a separate frontend origin can echo the nonce without reading an API-origin cookie. |
| `POST /refresh` | No refresh cookie means signed out: `204` with no body and no cookie. A valid cookie rotates and returns `200` `SessionResponse` with the rotated cookie. Every `AuthenticationRequiredException` (unusable or duplicated cookie; unknown, expired, revoked or replayed value; unavailable User) clears the cookie and becomes `401 AUTHENTICATION_REQUIRED`. |
| `POST /logout` | Passes each distinct usable cookie value to `AuthenticationService.logout`, then clears the cookie and returns `204`; without a cookie it still clears. If revocation fails, the exception propagates before the cookie is cleared. |

## Boundaries

The controller throws domain exceptions; `ApiExceptionHandler` turns them into the bounded envelope (`400`, `401`, `409`, or `500` for persistence and transaction failures). `RequestCorrelationFilter` supplies `Cache-Control: no-store` and `X-Request-ID`. The security chain bounds login and registration bodies, requires CSRF for refresh and logout, and applies CORS before this controller runs. OTP, recovery, MFA and OAuth are not represented here.

## Verification

`AuthControllerTest` covers the registration projection, login responses and length boundaries, the CSRF bootstrap, `204` refresh without a cookie, rotation `Max-Age`, cookie clearing on rejected refresh and logout of each distinct value. `RegistrationIT`, `SignInIT`, `SessionIT` and `ConcurrentSessionIT` cover the routes over real HTTP and PostgreSQL.
