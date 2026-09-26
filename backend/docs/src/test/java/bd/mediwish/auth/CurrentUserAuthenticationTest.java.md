# CurrentUserAuthenticationTest

Verifies that current-user loading requires token/session validation and a usable persisted Argon2 verifier, then returns persisted current roles rather than role claims supplied by a token. It also distinguishes an authenticated User with no required role (the test-only authority decision is denied, corresponding to `403`) from a missing/unusable User (the current-user seam fails authentication, corresponding to `401`), while `mobile_verified=false` remains independent of usability.
