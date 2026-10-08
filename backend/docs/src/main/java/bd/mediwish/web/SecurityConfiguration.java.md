# `SecurityConfiguration.java`

Source: [SecurityConfiguration.java](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

Stateless servlet security boundary. Hosted cookies must be Secure, and hosted credentialed CORS must list explicit origins. Only exclusively local/test profiles allow insecure cookies and loopback fallback origins. Allowed CORS methods are GET, POST, PUT, DELETE, HEAD and OPTIONS; allowed headers are Authorization, Content-Type and X-XSRF-TOKEN.

The static RoleHierarchy bean declares ADMIN > MODERATOR > DELIVERY_PERSON > CUSTOMER. Spring Security 7.1.1 automatically supplies it to its authorization-manager factory. Staff/profile routes use their minimum role; restricted MFA authorities are outside this hierarchy.

## Route matchers

| Matcher | Routes and use |
| --- | --- |
| `CREDENTIAL_ROUTES` | `POST /api/auth/register` and `POST /api/auth/login`: public, CSRF-exempt (no session exists yet) and body-limited. Percent-encoded spellings match as Spring MVC routes them. |
| `MFA_ROUTES` | `POST /api/auth/mfa/enrollment`, `/enrollment/verify` and `/mfa/verify`: Bearer-only, so CSRF-exempt, and body-limited like sign-in. |
| `USER_PROFILE_READ`, `USER_PROFILE_COMMANDS` | Ticket 11: `GET /api/user/me/profile`; `PUT /api/user/me/profile` and `POST`/`DELETE /api/user/me/mobile-change`. |
| `ADMIN_USER_SEARCH`, `ADMIN_USER_DETAIL`, `ADMIN_ROLE_CHANGE` | Ticket 08: `POST /api/admin/users/search`, `GET /api/admin/users/*` and `PUT /api/admin/users/*/roles`. |
| `BEARER_COMMAND_ROUTES` | Admin search, role changes and the profile commands. CSRF-exempt because a cross-site page cannot supply the in-memory Bearer header, and subject to the shared 16 KiB JSON limit. A bodyless `DELETE` passes the limiter unchanged. |
| `PROTECTED_ROUTES` | Every route that needs a Bearer token: `GET /api/user/me`, `GET /api/staff/me`, the MFA, profile and admin routes. `BearerAccessTokenFilter` uses it. |

## Filter chain

- **CSRF:** `CookieCsrfTokenRepository` with a script-readable `XSRF-TOKEN` cookie at `/api`, `SameSite=Lax`, Secure per the cookie setting, and the raw `X-XSRF-TOKEN` header handler. CSRF is ignored only for `CREDENTIAL_ROUTES`, `MFA_ROUTES` and `BEARER_COMMAND_ROUTES`; refresh, logout and every other unsafe request need the token.
- **Filters:** `BoundedCorsFilter` before `SecurityContextHolderFilter`; `AuthRequestBodyLimitFilter` after it, bounding the credential, MFA and Bearer command routes at 16 KiB; and `BearerAccessTokenFilter` after `LogoutFilter`. All three are constructed here, not registered as beans.
- **Authorization:** authorities come from `StaffAccessPolicy` through the bearer filter.

  | Request | Rule |
  | --- | --- |
  | ERROR dispatches, `GET`/`HEAD` liveness and readiness, `POST /api/auth/register\|login\|refresh\|logout`, `GET /api/auth/csrf` | permitted |
  | `POST /api/auth/mfa/enrollment`, `/enrollment/verify` | authority `StaffAccessPolicy.MFA_ENROLLMENT` |
  | `POST /api/auth/mfa/verify` | authority `StaffAccessPolicy.MFA_CHALLENGE` |
  | `GET /api/staff/me` | role `MODERATOR` or higher (only a verified staff session has a staff role) |
  | `GET /api/user/me` | role `CUSTOMER` or higher |
  | profile read and commands | explicitly `CUSTOMER`, `DELIVERY_PERSON`, `MODERATOR` or `ADMIN` (correct with or without the hierarchy) |
  | admin search, detail and role change | role `ADMIN` |
  | anything else | denied |

- **Errors:** missing authentication is `401 AUTHENTICATION_REQUIRED` with `WWW-Authenticate: Bearer`. A denial is `403 MFA_REQUIRED` for a restricted staff session (one of `StaffAccessPolicy.MFA_AUTHORITIES`) and `403 ACCESS_DENIED` otherwise; an unsafe request without a valid CSRF token is rejected by the CSRF filter with `403`.

`RequestCorrelationFilter` adds correlation and `no-store` headers before this chain. The whole configuration is servlet-conditional, so offline first-Admin provisioning has no web-security beans.

## Verification

`SecurityConfigurationTest` covers the Secure-cookie profile rule, credentialed CORS limits and methods, the local origin fallback, wildcard rejection, the `XSRF-TOKEN` cookie attributes, the role hierarchy, and that the profile and admin routes are Bearer-protected and the admin commands body-limited. `BoundedCorsFilterTest`, `AuthRequestBodyLimitFilterTest`, `ProfileBodyLimitTest` and `BearerAccessTokenFilterTest` cover the installed filters. `SessionIT`, `HealthIT`, `ProfileIT`, `RoleAuthorizationIT`, `StaffMfaIT`, `StaffMfaRegressionIT`, `StaffRoleIT` and `UserProfilePermissionIT` cover CSRF, route rules, MFA and role denials and error statuses over real HTTP and PostgreSQL.
