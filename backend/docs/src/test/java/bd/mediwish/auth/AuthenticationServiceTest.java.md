# AuthenticationServiceTest

Unit coverage, with mocked repositories, encoder and session service, for:
- **Sign-in:** the one User an identifier names signs in and receives its profile; a wrong password fails without a session. An unknown identifier, an identifier naming two Users across fields (a legacy username equal to another User's verified mobile), a blank identifier (which never calls the email lookup) and a User with an unusable stored verifier all fail generically after comparing the password against the dummy verifier, never the real one.
- **Dummy verifier:** with the production encoder, the dummy is generated at startup as a usable Argon2id verifier with the production parameters.
- **Refresh:** an access token is issued for the rotated session; when the User can no longer sign in (blank or unusable verifier), the rotated session is revoked with `USER_UNAVAILABLE` and authentication is required.
- **Logout:** every presented cookie is passed to `SessionService.revokeByRefreshTokens` with `LOGOUT`.

Tests use synthetic users and never print passwords, verifiers or refresh values.
