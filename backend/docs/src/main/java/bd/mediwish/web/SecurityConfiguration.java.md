# `SecurityConfiguration.java`

Source: [`src/main/java/bd/mediwish/web/SecurityConfiguration.java`](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

## Purpose

Package-private configuration of the stateless Spring Security boundary: CSRF, credentialed CORS, the web filters, route authorization and bounded security errors. HTTP Basic and server sessions are not used. Password hashing belongs to `AuthCoreConfiguration`.

It is `@ConditionalOnWebApplication(SERVLET)`: a non-web context, such as the first-Admin command started with `spring.main.web-application-type=none`, has no `HttpSecurity` and would otherwise fail to start, so there the whole configuration, including its Secure-cookie and CORS startup checks, is skipped.

## Members

| Member | Behavior |
| --- | --- |
| Constructor | Treats the process as local only when at least one profile is active and every active profile is `local` or `test`. Fails startup with `IllegalStateException` when `AuthProperties.cookie().secure()` is `false` outside a local process. |
| `MFA_ROUTES` | `POST /api/auth/mfa/enrollment`, `POST /api/auth/mfa/enrollment/verify` and `POST /api/auth/mfa/verify`. Bearer-only, so they are CSRF-exempt (a cross-site page cannot send the in-memory access token), and body-limited like sign-in. |
| `PROTECTED_ROUTES` | Shared matcher of every route that needs a Bearer token: `GET /api/user/me`, `GET /api/staff/me` and `MFA_ROUTES`. `BearerAccessTokenFilter` uses it. |
| `CREDENTIAL_ROUTES` | Shared matcher of `POST /api/auth/register` and `POST /api/auth/login`. The CSRF exemption, the `permitAll()` rule and `AuthRequestBodyLimitFilter` all use it, so they always agree on which requests are credential requests, including percent-encoded spellings of the paths. |
| `corsConfigurationSource(allowedOrigins)` | Reads comma-separated `app.cors.allowed-origins`. When empty, a local process falls back to `http://127.0.0.1:3000` and `http://localhost:3000`; otherwise startup fails. `*` fails startup because credentials are allowed. Allows methods `GET`, `POST`, `HEAD`, `OPTIONS`, headers `Authorization`, `Content-Type`, `X-XSRF-TOKEN`, credentials and a one-hour preflight cache. |
| `csrfTokenRepository()` | The `CookieCsrfTokenRepository` the chain uses, described under CSRF below. Package-private so a unit test can check the cookie it writes. |
| `security(...)` | Builds the filter chain described below. |

## Filter chain

- **CSRF:** `CookieCsrfTokenRepository` with a script-readable `XSRF-TOKEN` cookie at `/api`, `SameSite=Lax`, Secure per the cookie setting, and the raw `X-XSRF-TOKEN` header handler. CSRF is ignored only for `CREDENTIAL_ROUTES` and `MFA_ROUTES`; every other unsafe request, including refresh and logout, needs the token.
- **Filters:** `BoundedCorsFilter` before `SecurityContextHolderFilter`; `AuthRequestBodyLimitFilter` after it, bounding `CREDENTIAL_ROUTES` and `MFA_ROUTES` at 16 KiB; and `BearerAccessTokenFilter` after `LogoutFilter`. All three are constructed here, not registered as beans.
- **Authorization:** the authorities come from `StaffAccessPolicy`, through the bearer filter.

  | Request | Rule |
  | --- | --- |
  | ERROR dispatches, `GET`/`HEAD` liveness and readiness, `POST /api/auth/register\|login\|refresh\|logout`, `GET /api/auth/csrf` | permitted |
  | `POST /api/auth/mfa/enrollment`, `/enrollment/verify` | authority `StaffAccessPolicy.MFA_ENROLLMENT` |
  | `POST /api/auth/mfa/verify` | authority `StaffAccessPolicy.MFA_CHALLENGE` |
  | `GET /api/staff/me` | role `ADMIN` or `MODERATOR` (only a verified staff session has them) |
  | `GET /api/user/me` | any of the four roles (a restricted staff session has none) |
  | anything else | denied |

- **Errors:** the authentication entry point always writes `401 AUTHENTICATION_REQUIRED` with `WWW-Authenticate: Bearer`. The access-denied handler writes `403 MFA_REQUIRED` when the current authentication holds one of `StaffAccessPolicy.MFA_AUTHORITIES` (a staff session that must still enroll or verify) and `403 ACCESS_DENIED` otherwise. A denied anonymous request, such as `POST` to a health probe with a valid CSRF token, gets `401`; an unsafe request without a valid CSRF token is rejected earlier by the CSRF filter through the access-denied handler with `403`.

Correlation and `no-store` headers come from `RequestCorrelationFilter`, which runs before this chain.

## Verification

`SecurityConfigurationTest` covers the Secure-cookie profile rule, credentialed CORS limits, the local origin fallback, wildcard rejection and the hosted `XSRF-TOKEN` cookie attributes. `BoundedCorsFilterTest`, `AuthRequestBodyLimitFilterTest` and `BearerAccessTokenFilterTest` cover the installed filters. `SessionIT`, `HealthIT` and `ProfileIT` cover CSRF, route rules and error statuses over real HTTP. `RoleAuthorizationIT`, `StaffMfaIT` and `StaffMfaRegressionIT` cover the role and MFA rules, `MFA_REQUIRED`, the CSRF exemption and body limit of the MFA routes. `FirstAdminProvisioningIT` starts the non-web context without this configuration.
