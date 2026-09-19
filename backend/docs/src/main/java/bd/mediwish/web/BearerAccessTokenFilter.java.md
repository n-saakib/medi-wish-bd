# `BearerAccessTokenFilter.java`

Source: [`src/main/java/bd/mediwish/web/BearerAccessTokenFilter.java`](../../../../../../../src/main/java/bd/mediwish/web/BearerAccessTokenFilter.java)

## Purpose

The stateless HTTP adapter for access authentication. It accepts exactly one bounded `Authorization: Bearer` value, delegates verification and current-session/User loading to `CurrentUserAuthentication`, then places the current User and persisted role authorities in Spring Security's context.

Basic authentication, query parameters, cookies and username claims are not authentication sources. Invalid bearer values receive a bounded 401 with a Bearer challenge and no token details.

## Filter order

`SecurityConfiguration` registers this filter after `LogoutFilter` and before authorization processing. The filter does not parse JJWT or inspect refresh-token storage; `AccessTokenCodec` and T2 session services remain the only credential boundaries.

## Verification

`BearerAccessTokenFilterTest` covers current-user profile projection, invalid bearer rejection, Basic non-authentication and refresh-cookie non-authentication.
