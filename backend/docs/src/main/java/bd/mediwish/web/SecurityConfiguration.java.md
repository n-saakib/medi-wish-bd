# `SecurityConfiguration.java`

Source: [`src/main/java/bd/mediwish/web/SecurityConfiguration.java`](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

## Purpose and reasoning

Defines the stateless Spring Security boundary for Ticket 03. HTTP Basic and server sessions are absent. Public registration, login, CSRF bootstrap and health probes are explicit; refresh and logout are cookie-backed controller seams protected by CSRF; the current User profile requires a verified Bearer access token.

## Security configuration

| Member | Behavior |
| --- | --- |
| `security(...)` | Enables cookie-backed CSRF, explicit credentialed CORS, stateless sessions, bounded errors and route authorization. It registers `BearerAccessTokenFilter` after `LogoutFilter`, uses the raw double-submit cookie/header handler, ignores CSRF only for exact method+URI matches for registration, login and CSRF bootstrap, permits the fixed auth/health routes, requires authentication for `GET /api/user/me`, and denies unknown routes. |
| `csrfTokenRepository(...)` | Uses `CookieCsrfTokenRepository.withHttpOnlyFalse()` with `XSRF-TOKEN` and `X-XSRF-TOKEN`, `/api` path, SameSite=Lax and configured Secure behavior. |
| `corsConfigurationSource(...)` | Allows only explicit origins, `GET/POST/HEAD/OPTIONS`, credentials and the fixed authorization/content/correlation/CSRF headers. Wildcard origins fail closed because credentials are enabled. |
| `authConfigurationValidation(...)` | Fails startup when the Base64 HMAC secret is absent, invalid or shorter than 32 decoded bytes, the dummy verifier is absent, or an active production profile disables Secure auth cookies. No secret is logged. |
| `passwordEncoder()` | Provides the existing Argon2 password encoder for registration/authentication core code. |

The application uses `APP_AUTH_COOKIE_SECURE=true` by default. Local HTTP tests may explicitly override it to false; the `prod`/`production` profiles fail startup if Secure cookies are disabled. JWT parsing and session-state decisions remain behind T2's `AccessTokenCodec`, `CurrentUserAuthentication` and `SessionService` interfaces.

## Verification

`SecurityConfigurationTest` verifies Argon2, explicit credentialed CORS, wildcard rejection, CSRF cookie attributes and fail-closed secret/dummy-verifier validation. `BearerAccessTokenFilterTest` verifies the bearer/current-principal handoff and Basic/cookie rejection.
