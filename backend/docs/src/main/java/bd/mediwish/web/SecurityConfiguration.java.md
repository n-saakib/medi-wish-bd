# `SecurityConfiguration.java`

Source: [`src/main/java/bd/mediwish/web/SecurityConfiguration.java`](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

Package-private servlet configuration owns stateless Spring Security, credentialed CORS, cookie CSRF, bearer authentication and route authorization. It is absent from the non-web first-Admin command. Insecure cookies and loopback origin fallback require exclusively local/test profiles; hosted origins must be explicit and cannot contain `*`.

## Route matchers and authorization

| Matcher/routes | Rule |
| --- | --- |
| ERROR dispatch, GET/HEAD health, credential POST, GET CSRF, POST refresh/logout | Public; refresh/logout still require cookie CSRF |
| MFA enrollment/verification routes | Matching MFA enrollment/challenge authority |
| GET `/api/staff/me` | ADMIN or MODERATOR |
| GET `/api/user/me` | Any of the four roles |
| STAFF_CATALOG_READS: GET categories/products and products/* | ADMIN or MODERATOR |
| STAFF_CATALOG_COMMANDS: POST categories/products, PUT categories/* and products/* | ADMIN or MODERATOR |
| STAFF_PRICING: PUT products/*/pricing | ADMIN; matched before catalog rules |
| Other routes/methods | Denied |

The catalog wildcard captures exactly one segment and excludes pricing. Explicit ADMIN/MODERATOR lists support an Admin holding only ADMIN before or after the Ticket 08 hierarchy. PROTECTED_ROUTES contains the profile, MFA and all catalog matchers; BearerAccessTokenFilter resolves the current session, roles and MFA on every request. A denied anonymous request gets 401 AUTHENTICATION_REQUIRED and a Bearer challenge; restricted staff gets 403 MFA_REQUIRED; other denied callers get 403 ACCESS_DENIED.

## Filters and transport

BoundedCorsFilter precedes SecurityContextHolderFilter. Credential/MFA JSON body limits remain immediately after CORS. BearerAccessTokenFilter follows LogoutFilter. A separate catalog body-limit instance follows AuthorizationFilter, guaranteeing denied pricing is rejected before any JSON body reading, including malformed/oversized bodies. Allowed catalog commands share the 16 KiB JSON cap.

BEARER_COMMAND_ROUTES combines MFA, catalog commands and pricing. These routes plus credential routes are CSRF-exempt because they use in-memory Bearer tokens. Refresh/logout retain the readable XSRF-TOKEN cookie at `/api`, SameSite=Lax, Secure per configuration, with X-XSRF-TOKEN headers. CORS allows GET, POST, PUT, HEAD and OPTIONS, explicit origins, credentials and Authorization/Content-Type/X-XSRF-TOKEN headers, with a one-hour preflight cache.

RequestCorrelationFilter wraps the chain and supplies no-store and X-Request-ID. The chain constructs filters directly; they are not separately registered servlet beans.

SecurityConfigurationTest covers startup/CORS/cookie rules and exact catalog wildcard separation. CatalogSecurityTest executes the production chain over every catalog route for anonymous, single-role staff, Customer, DeliveryPerson and both restricted MFA states, plus oversized-body authorization order and PUT preflight. Existing authentication/MFA integration suites retain cumulative coverage.