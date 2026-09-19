# AuthenticationService

Deep application seam for password sign-in, refresh, logout and future revoke-all operations. It resolves normalized username, verified mobile and optional email candidates, runs the configured dummy verifier for missing or ambiguous candidates, verifies the password and returns a safe user profile plus adapter-only raw refresh value. Controllers do not call User or session repositories directly.
