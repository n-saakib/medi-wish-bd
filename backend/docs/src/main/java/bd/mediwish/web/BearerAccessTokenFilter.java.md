# `BearerAccessTokenFilter.java`

Source: [`src/main/java/bd/mediwish/web/BearerAccessTokenFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/BearerAccessTokenFilter.java)

## Purpose

The stateless HTTP adapter for access authentication. It runs only for the protected `GET /api/user/me` route, accepts exactly one bounded `Authorization: Bearer` value, delegates verification and current-session/User loading to `CurrentUserAuthentication`, then places the current User and persisted role authorities in Spring Security's context.

Basic authentication, query parameters, cookies and username claims are not authentication sources. Invalid bearer values receive a bounded 401 with a Bearer challenge and no token details.

If current-session/User lookup fails with a persistence, data-access or transaction exception, the filter returns the generic no-store `500 INTERNAL_ERROR` envelope without propagating diagnostic details to the servlet container. This handling is limited to identity loading; exceptions from the downstream application chain are not swallowed.

## Filter order

`SecurityConfiguration` registers this filter after `LogoutFilter` and before authorization processing. Public login, registration, CSRF bootstrap, refresh, logout and health requests bypass bearer parsing, so an unrelated invalid header cannot block them. The filter does not parse JJWT or inspect refresh-token storage; `AccessTokenCodec` and T2 session services remain the only credential boundaries.

## Verification

`BearerAccessTokenFilterTest` covers current-user profile projection, invalid bearer rejection, bounded handling of persistence, data-access and transaction failures during identity loading, Basic non-authentication, refresh-cookie non-authentication and the public-route bypass for oversized bearer values. `AuthIT` exercises the database-failure envelope and diagnostic-log boundary over real HTTP and PostgreSQL.
