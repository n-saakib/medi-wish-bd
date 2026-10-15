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
| `STAFF_CATALOG_READS`, `STAFF_CATALOG_COMMANDS`, `STAFF_PRICING` | Ticket 14: `GET` categories, products and products/*; `POST` categories/products and `PUT` categories/* and products/*; `PUT /api/staff/products/*/pricing`. The catalog `PUT` wildcard matches one segment, so it never captures pricing. |
| `BEARER_COMMAND_ROUTES` | Admin search, role changes, the profile commands, catalog commands and pricing. CSRF-exempt because a cross-site page cannot supply the in-memory Bearer header. Every one is bounded to 16 KiB of JSON: the account commands before authentication, the catalog commands after authorization. A bodyless `DELETE` passes the limiter unchanged. |
| `PROTECTED_ROUTES` | Every route that needs a Bearer token: `GET /api/user/me`, `GET /api/staff/me`, the MFA, profile, admin and staff catalog routes. `BearerAccessTokenFilter` uses it. |

The catalog wildcard captures exactly one segment and excludes pricing. Explicit ADMIN/MODERATOR lists support an Admin holding only ADMIN before or after the Ticket 08 hierarchy. PROTECTED_ROUTES contains the profile, MFA and all catalog matchers; BearerAccessTokenFilter resolves the current session, roles and MFA on every request. A denied anonymous request gets 401 AUTHENTICATION_REQUIRED and a Bearer challenge; restricted staff gets 403 MFA_REQUIRED; other denied callers get 403 ACCESS_DENIED.

- **CSRF:** `CookieCsrfTokenRepository` with a script-readable `XSRF-TOKEN` cookie at `/api`, `SameSite=Lax`, Secure per the cookie setting, and the raw `X-XSRF-TOKEN` header handler. CSRF is ignored only for `CREDENTIAL_ROUTES`, `MFA_ROUTES` and `BEARER_COMMAND_ROUTES`; refresh, logout and every other unsafe request need the token.
- **Filters:** `BoundedCorsFilter` before `SecurityContextHolderFilter`; one `AuthRequestBodyLimitFilter` after it, bounding the credential, MFA, admin and profile command routes at 16 KiB; `BearerAccessTokenFilter` after `LogoutFilter`; and a second `AuthRequestBodyLimitFilter` after `AuthorizationFilter` for the catalog commands and pricing, so a denied pricing request stays `403` whatever its body size or syntax. All are constructed here, not registered as beans.
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
  | `STAFF_PRICING` | role `ADMIN` |
  | `STAFF_CATALOG_READS`, `STAFF_CATALOG_COMMANDS` | explicitly `ADMIN` or `MODERATOR` (correct with or without the hierarchy) |
  | anything else | denied |

- **Errors:** missing authentication is `401 AUTHENTICATION_REQUIRED` with `WWW-Authenticate: Bearer`. A denial is `403 MFA_REQUIRED` for a restricted staff session (one of `StaffAccessPolicy.MFA_AUTHORITIES`) and `403 ACCESS_DENIED` otherwise; an unsafe request without a valid CSRF token is rejected by the CSRF filter with `403`.

`RequestCorrelationFilter` adds correlation and `no-store` headers before this chain. The whole configuration is servlet-conditional, so offline first-Admin provisioning has no web-security beans.

## Verification

`SecurityConfigurationTest` covers the Secure-cookie profile rule, credentialed CORS limits and methods, the local origin fallback, wildcard rejection, the `XSRF-TOKEN` cookie attributes, the role hierarchy, exact catalog wildcard separation, and that the profile, admin and catalog routes are Bearer-protected Bearer commands. `BoundedCorsFilterTest`, `AuthRequestBodyLimitFilterTest`, `ProfileBodyLimitTest` and `BearerAccessTokenFilterTest` cover the installed filters. `CatalogSecurityTest` runs the production chain over every catalog route for each actor, including oversized-body authorization order and `PUT` preflight. `SessionIT`, `HealthIT`, `ProfileIT`, `RoleAuthorizationIT`, `StaffMfaIT`, `StaffMfaRegressionIT`, `StaffRoleIT` and `UserProfilePermissionIT` cover CSRF, route rules, MFA and role denials and error statuses over real HTTP and PostgreSQL.


Ticket 15 adds explicit staff image reads/commands for verified Admin and Moderator. Multipart uploads bypass the JSON limiter and are bounded globally at 3 MiB per file and 4 MiB request. Alt/order JSON remains limited after authorization. Public images permit GET/HEAD only; denied image-path methods get ACCESS_DENIED even for anonymous callers with valid CSRF. All error responses remain no-store.
## Ticket 16 discount routes

STAFF_DISCOUNT_READS is GET /api/staff/discounts; STAFF_DISCOUNT_COMMANDS is POST at that collection, PUT at one id segment, and POST at one id/end. Both require fresh Bearer authentication and ADMIN through an MFA-verified session. Commands are CSRF-exempt and use the body limiter after AuthorizationFilter so denied requests keep their authentication/authorization error for every body size. PUBLIC_PRODUCT_PRICE matches only GET /api/products/*/price, permits anonymous access and stays outside PROTECTED_ROUTES, so Authorization headers do not affect the public read. DiscountSecurityTest executes the production chain; matcher tests pin wildcard separation.
