# CurrentUserAuthentication

Verifies an access token through `AccessTokenCodec`, checks the matching active session family, loads the current User only when its persisted Argon2 verifier is structurally usable, and returns current persisted roles. Missing or malformed credential state fails closed as authentication-required. It does not trust role claims from JWTs and is the seam for later account-state or staff-MFA assurance checks.
