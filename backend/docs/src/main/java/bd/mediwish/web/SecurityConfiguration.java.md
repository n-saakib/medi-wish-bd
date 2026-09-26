# `SecurityConfiguration.java`

Source: [`src/main/java/bd/mediwish/web/SecurityConfiguration.java`](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

## Purpose

Package-private configuration of the stateless Spring Security boundary: CSRF, credentialed CORS, the web filters, route authorization and bounded security errors. HTTP Basic and server sessions are not used. Password hashing belongs to `AuthCoreConfiguration`.

## Members

| Member | Behavior |
| --- | --- |
| Constructor | Treats the process as local only when at least one profile is active and every active profile is `local` or `test`. Fails startup with `IllegalStateException` when `AuthProperties.cookie().secure()` is `false` outside a local process. |
| `PROTECTED_ROUTES` | Shared matcher of every route that needs a Bearer token, currently `GET /api/user/me`. The bearer filter and the `authenticated()` rule both use it. |
| `CREDENTIAL_ROUTES` | Shared matcher of `POST /api/auth/register` and `POST /api/auth/login`. The CSRF exemption, the `permitAll()` rule and `AuthRequestBodyLimitFilter` all use it, so the three always agree on which requests are credential requests, including percent-encoded spellings of the paths. |
| `corsConfigurationSource(allowedOrigins)` | Reads comma-separated `app.cors.allowed-origins`. When empty, a local process falls back to `http://127.0.0.1:3000` and `http://localhost:3000`; otherwise startup fails. `*` fails startup because credentials are allowed. Allows methods `GET`, `POST`, `HEAD`, `OPTIONS`, headers `Authorization`, `Content-Type`, `X-XSRF-TOKEN`, credentials and a one-hour preflight cache. |
| `csrfTokenRepository()` | The `CookieCsrfTokenRepository` the chain uses, described under CSRF below. Package-private so a unit test can check the cookie it writes. |
| `security(...)` | Builds the filter chain described below. |

## Filter chain

- **CSRF:** `CookieCsrfTokenRepository` with a script-readable `XSRF-TOKEN` cookie at `/api`, `SameSite=Lax`, Secure per the cookie setting, and the raw `X-XSRF-TOKEN` header handler. CSRF is ignored only for `CREDENTIAL_ROUTES`; every other unsafe request, including refresh and logout, needs the token.
- **Filters:** `BoundedCorsFilter` before `SecurityContextHolderFilter`, `AuthRequestBodyLimitFilter` after it, and `BearerAccessTokenFilter` after `LogoutFilter`. All three are constructed here, not registered as beans.
- **Authorization:** ERROR dispatches, `GET`/`HEAD` liveness and readiness probes, `POST /api/auth/register|login|refresh|logout` and `GET /api/auth/csrf` are permitted; `PROTECTED_ROUTES` require authentication; every other request is denied.
- **Errors:** the authentication entry point always writes `401 AUTHENTICATION_REQUIRED` with `WWW-Authenticate: Bearer`; the access-denied handler writes `403 ACCESS_DENIED`. There are no route-specific status overrides. A denied anonymous request, such as `POST` to a health probe with a valid CSRF token, gets `401`; an unsafe request without a valid CSRF token is rejected earlier by the CSRF filter through the access-denied handler with `403`.

Correlation and `no-store` headers come from `RequestCorrelationFilter`, which runs before this chain.

## Verification

`SecurityConfigurationTest` covers the Secure-cookie profile rule, credentialed CORS limits, the local origin fallback, wildcard rejection and the hosted `XSRF-TOKEN` cookie attributes. `BoundedCorsFilterTest`, `AuthRequestBodyLimitFilterTest` and `BearerAccessTokenFilterTest` cover the installed filters. `SessionIT`, `HealthIT` and `ProfileIT` cover CSRF, route rules and error statuses over real HTTP; `RoleAuthorizationIT` covers the role-based 403.
