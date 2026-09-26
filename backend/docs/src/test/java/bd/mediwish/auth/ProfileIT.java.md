# `ProfileIT.java`

Source: [`src/test/java/bd/mediwish/auth/ProfileIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/ProfileIT.java)

## Purpose

`GET /api/user/me` on the shared context:

- the Bearer reads their own profile, and the response never echoes the access or refresh token;
- the JWT payload carries no username, mobile, email, password, refresh value or role;
- a missing, Basic, non-token, empty or oversized Bearer value, or a refresh cookie, gets 401 with `WWW-Authenticate: Bearer`;
- a valid token as the `access_token` or `token` query parameter, an `X-Auth-Token` header or an `access_token` cookie is ignored;
- a validly signed token whose subject or session alone was changed is rejected;
- a token stops working once its User is deleted or can no longer sign in.

## Verification

17 tests. The Java HTTP client cannot send `Proxy-Authorization`, so that placement is covered by `BearerAccessTokenFilterTest`.

Verified 2026-09-26 on `72634a6`: `./mvnw.cmd -o verify` passed 171 unit and 106 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 106 with no skip.
