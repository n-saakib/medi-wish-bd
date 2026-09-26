# `AuthApi.java`

Source: [`src/test/java/bd/mediwish/auth/AuthApi.java`](../../../../../../../src/test/java/bd/mediwish/auth/AuthApi.java)

## Purpose

Package-private client for the auth integration tests. `AuthApi.Shared` is a JUnit `ParameterResolver` that stores one `AuthApi` (one schema and one application) in the root extension store, so `RegistrationIT`, `SignInIT`, `SessionIT`, `ConcurrentSessionIT` and `ProfileIT` share one context, which JUnit closes at the end of the run. `start(testConfigurations...)` gives `SessionRestartIT` and `RoleAuthorizationIT` their own.

It creates unique synthetic Users (digit-only `017` mobiles), registers and signs them in, and checks every 200 session against the contract: a 900-second Bearer token, the profile and a 30-day HttpOnly `MW_REFRESH` cookie. It bootstraps the CSRF pair once and sends refresh and logout with the cookie, the CSRF header and the allowed Origin. Every password, token and cookie it sees is tracked; 204 and error responses, and the captured logs (`assertLogsOmitSecrets`), must omit every tracked value. Database helpers read sessions, generations and revocation reasons, verify mobiles, and install `failCommitsWhere`, a deferred constraint trigger that makes a matching commit fail. `race` releases two requests at once and returns their responses in argument order, for the racing registrations in `RegistrationIT` and the racing logouts and refresh in `ConcurrentSessionIT`.

## Verification

Exercised by every auth integration test.
