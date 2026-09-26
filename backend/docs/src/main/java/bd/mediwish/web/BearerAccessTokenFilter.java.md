# `BearerAccessTokenFilter.java`

Source: [`src/main/java/bd/mediwish/web/BearerAccessTokenFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/BearerAccessTokenFilter.java)

## Purpose

Package-private stateless adapter that turns one verified `Authorization: Bearer` access token into the current persisted User principal. `SecurityConfiguration` constructs it with the shared `PROTECTED_ROUTES` matcher and registers it after `LogoutFilter`; it is not a Spring bean.

## Behavior

- Requests outside `PROTECTED_ROUTES` (currently only `GET /api/user/me`) skip the filter, so public routes never read the header.
- No `Authorization` header, or a non-Bearer scheme such as Basic, continues unauthenticated; authorization then answers `401`.
- More than one `Authorization` header is rejected before verification.
- A Bearer value is passed to `CurrentUserAuthentication.authenticate`. `AuthenticationRequiredException` becomes `401 AUTHENTICATION_REQUIRED` with `WWW-Authenticate: Bearer`. `DataAccessException` or `TransactionException` becomes `500 INTERNAL_ERROR` without diagnostics; exceptions from the downstream chain are not caught.
- On success the principal is the `UserProfile` of the `CurrentUser` and each persisted role becomes a `ROLE_<NAME>` authority.

Query parameters, cookies and role claims are never authentication sources. The filter does not parse JWTs or touch session storage.

## Verification

`BearerAccessTokenFilterTest` covers verified authentication with persisted roles, invalid Bearer rejection with a challenge, multiple header rejection, missing and non-Bearer headers, public-route bypass and the bounded persistence failure. `ProfileIT` and `RoleAuthorizationIT` cover it over real HTTP and PostgreSQL.
