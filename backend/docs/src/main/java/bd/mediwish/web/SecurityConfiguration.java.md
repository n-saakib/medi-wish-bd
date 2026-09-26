# `SecurityConfiguration.java`

Source: [`src/main/java/bd/mediwish/web/SecurityConfiguration.java`](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

## Purpose and reasoning

Defines the stateless Spring Security boundary for Ticket 03. HTTP Basic and server sessions are absent. Public registration, login, CSRF bootstrap and health probes are explicit; refresh and logout are cookie-backed controller seams protected by CSRF; the current User profile requires a verified Bearer access token.

## Security configuration

| Member | Behavior |
| --- | --- |
| `security(...)` | Enables cookie-backed CSRF, explicit credentialed CORS, stateless sessions, bounded errors and route authorization. It installs `BoundedCorsFilter` before the security context filter so Spring's own CORS policy produces the shared 403 envelope, bounds login/registration JSON through `AuthenticationJsonBodyLimitFilter`, registers `BearerAccessTokenFilter` after `LogoutFilter`, uses the raw double-submit cookie/header handler, ignores CSRF only for exact method+URI matches for registration, login and CSRF bootstrap, permits the fixed auth/health routes, requires authentication for `GET /api/user/me`, and denies unknown routes. |
| `csrfTokenRepository(...)` | Uses `CookieCsrfTokenRepository.withHttpOnlyFalse()` with `XSRF-TOKEN` and `X-XSRF-TOKEN`, `/api` path, SameSite=Lax and configured Secure behavior. |
| `corsConfigurationSource(...)` | Allows only explicit origins, `GET/POST/HEAD/OPTIONS`, credentials and the fixed authorization/content/correlation/CSRF headers. An unset origin property falls back to the documented loopback origins only when every active profile is explicitly recognized as `local`, `dev`, `development` or `test`; absent, blank and delimiter-only profiles fail closed. Wildcard origins fail closed because credentials are enabled. |
| `authConfigurationValidation(...)` | Fails startup when the Base64 HMAC secret is absent, invalid or shorter than 32 decoded bytes, the dummy verifier is absent or rejected by the configured Argon2 encoder, either token lifetime is shorter than one second, an access expiry cannot be represented as a JWT `Date`, a refresh expiry falls outside PostgreSQL's timestamp range, or a profile without an explicit local/dev/test opt-in disables Secure auth cookies. The representability checks are storage/runtime bounds, not product lifetime caps; no secret or verifier is logged. |
| `passwordEncoder()` | Provides the ADR-0019 Argon2id profile (`m=19456,t=2,p=1`) for new password hashes. Existing Ticket 02 hashes at `m=16384,t=2,p=1` remain verifiable during the session transition. |

The application uses `APP_AUTH_COOKIE_SECURE=true` by default. Local HTTP use may explicitly override it to false only under recognized local/dev/test profiles; an absent or empty active-profile value is treated as hosted. JWT parsing and session-state decisions remain behind T2's `AccessTokenCodec`, `CurrentUserAuthentication` and `SessionService` interfaces.

## Verification

`SecurityConfigurationTest` verifies Argon2, explicit credentialed CORS, wildcard rejection, local fallback and hosted-profile fail-closed behavior, CSRF cookie attributes and current secret/dummy-verifier validation. `BearerAccessTokenFilterTest` verifies the bearer/current-principal handoff, protected-route rejection and public-route bypass. `Ticket03SecurityBoundaryTest` verifies the bounded CORS rejection envelope and the endpoint-scoped pre-deserialization body ceiling.
