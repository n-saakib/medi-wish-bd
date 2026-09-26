# CurrentUserAuthenticationTest

Unit coverage for loading the current User from an access token. An active session resolves the persisted profile and current roles, not role claims from the token. An invalid token is rejected before the session is read, and a revoked or expired session before the User is read. A User whose stored verifier is blank or unusable is unauthenticated (`401`). `mobile_verified=false` does not affect usability.

Role denial (`403` for a signed-in User without the required role) is covered over HTTP by [`RoleAuthorizationIT`](RoleAuthorizationIT.java.md).
