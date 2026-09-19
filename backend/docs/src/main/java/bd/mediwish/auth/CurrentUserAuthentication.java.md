# CurrentUserAuthentication

Verifies an access token through `AccessTokenCodec`, checks the matching active session family, loads the current User and returns current persisted roles. It does not trust role claims from JWTs and is the seam for later account-state or staff-MFA assurance checks.
