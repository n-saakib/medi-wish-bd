# `CurrentUserAuthentication.java`

Source: [`src/main/java/bd/mediwish/auth/CurrentUserAuthentication.java`](../../../../../../../src/main/java/bd/mediwish/auth/CurrentUserAuthentication.java)

## Purpose

Public auth service that resolves an access token to the current User and the authorities the request is granted. `BearerAccessTokenFilter` is its only production caller.

## Behavior

`authenticate(accessToken)`:

1. verifies the token through `AccessTokenCodec`;
2. requires the token's session to be active, unexpired and bound to the token's User, and reads its MFA evidence (`SessionService.requireActive`);
3. loads the User and accepts it only when its stored verifier passes `PasswordVerifierPolicy`;
4. evaluates `StaffAccessPolicy` with the one role read now, the active factor (`StaffMfaFactorRepository.activeFactorIdOf`, queried only for staff) and the session evidence;
5. returns `CurrentUser(userId, sessionId, profile, roles, mfa, authorities)`.

Any failed step throws `AuthenticationRequiredException`. Role claims are never read from the token. Because roles, factor and evidence are read on every request, losing a staff role or having the factor replaced changes access on the next request. Persistence and transaction exceptions propagate unchanged; the bearer filter turns them into `500 INTERNAL_ERROR`.

`BearerAccessTokenFilter` makes the whole `CurrentUser` the Spring Security principal and grants exactly its `authorities`. Controllers read `profile` (`UserController`), the IDs (`StaffMfaController`) or the roles (`StaffController`) from it.

## Verification

`CurrentUserAuthenticationTest` covers the active-session profile, roles and authorities, a staff session granted its roles only with evidence for the active factor, rejection of invalid tokens and revoked or expired sessions before later lookups, and unusable verifiers. `ProfileIT`, `RoleAuthorizationIT`, `StaffMfaIT` and `StaffMfaRegressionIT` cover it through real HTTP and PostgreSQL.
