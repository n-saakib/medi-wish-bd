# `CurrentUserAuthentication.java`

Source: [`src/main/java/bd/mediwish/auth/CurrentUserAuthentication.java`](../../../../../../../src/main/java/bd/mediwish/auth/CurrentUserAuthentication.java)

## Purpose

Public auth service that resolves an access token to the current User. `BearerAccessTokenFilter` is its only production caller.

## Behavior

`authenticate(accessToken)`:

1. verifies the token through `AccessTokenCodec`;
2. requires the token's session to be active, unexpired and bound to the token's User (`SessionService.requireActive`);
3. loads the User and accepts it only when its stored verifier passes `PasswordVerifierPolicy`;
4. returns `CurrentUser(UserProfile profile, Set<UserRole> roles)` with the roles read now from persistence.

Any failed step throws `AuthenticationRequiredException`. Role claims are never read from the token. Persistence and transaction exceptions propagate unchanged; the bearer filter turns them into `500 INTERNAL_ERROR`.

`BearerAccessTokenFilter` makes `profile` the Spring Security principal and each role an authority.

## Verification

`CurrentUserAuthenticationTest` covers the active-session profile and roles, rejection of invalid tokens and revoked or expired sessions before later lookups, and unusable verifiers. `ProfileIT` and `RoleAuthorizationIT` cover it through real HTTP and PostgreSQL.
