# `CurrentUserAuthentication.java`

Source: [`src/main/java/bd/mediwish/auth/CurrentUserAuthentication.java`](../../../../../../../src/main/java/bd/mediwish/auth/CurrentUserAuthentication.java)

## Purpose

Public auth service that resolves an access token to the current User and the authorities the request is granted. `BearerAccessTokenFilter` is its only production caller.

## Behavior

`authenticate(accessToken)`:

1. verifies the token through `AccessTokenCodec`;
2. locks the current User FOR SHARE and accepts it only when its stored verifier passes `PasswordVerifierPolicy`;
3. requires the token's session to be active, unexpired and bound to that User, and reads its MFA evidence (`SessionService.requireActive`);
4. evaluates `StaffAccessPolicy` with the one role read now, the active factor (`StaffMfaFactorRepository.activeFactorIdOf`, queried only for staff) and the session evidence;
5. returns `CurrentUser(userId, sessionId, profile, roles, mfa, authorities)`.

`authenticate` owns one transaction. The User share lock is acquired before session evidence, role and factor reads and released when authentication returns, before route handling. Role changes and factor changes take a conflicting User write lock first, so a request either resolves the old role before a change or sees the committed revocation afterwards. An old verified Moderator token cannot combine earlier active-session evidence with a newly promoted Admin role. The transaction is not marked read-only because PostgreSQL forbids locking selects in a read-only transaction. The lock does not span the whole HTTP request.

Any failed step throws `AuthenticationRequiredException`. Role claims are never read from the token. Because roles, factor and evidence are read on every request, losing a staff role or having the factor replaced changes access on the next request. Persistence and transaction exceptions propagate unchanged; the bearer filter turns them into `500 INTERNAL_ERROR`.

`BearerAccessTokenFilter` makes the whole `CurrentUser` the Spring Security principal and grants exactly its `authorities`. Controllers read `profile` (`UserController`), the IDs (`StaffMfaController`) or the roles (`StaffController`) from it.

## Verification

`CurrentUserAuthenticationTest` covers the active-session profile, roles and authorities, a staff session granted its roles only with evidence for the active factor, rejection of invalid tokens before repository access, revoked or expired sessions after the User lock/verifier validation but before factor lookup or authority evaluation, and unusable verifiers. `ConcurrentRoleChangeIT` forces Admin search/detail authentication versus promotion in both serial orders, proves actual PostgreSQL lock waiting and rejects the old token afterwards. `ProfileIT`, `RoleAuthorizationIT`, `StaffMfaIT` and `StaffMfaRegressionIT` cover it through real HTTP and PostgreSQL.

Ticket 09 passes the current session replacement binding into policy evaluation on every request. A replacement principal has only `MFA_REPLACEMENT`, and a stale binding downgrades without ever granting a role authority.
