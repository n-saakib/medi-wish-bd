# `AccessTokenCodec.java`

Source: [`src/main/java/bd/mediwish/auth/AccessTokenCodec.java`](../../../../../../../src/main/java/bd/mediwish/auth/AccessTokenCodec.java)

## Purpose

Public auth seam for issuing and verifying access tokens. It hides the JOSE library from `AuthenticationService`, `CurrentUserAuthentication` and the web adapters; `JwtAccessTokenCodec` is the only implementation.

## API

| Member | Behavior |
| --- | --- |
| `issue(userId, sessionId)` | Returns `IssuedAccessToken(token, expiresInSeconds)`. |
| `verify(token)` | Returns `AccessTokenClaims(userId, sessionId)`, or throws `AuthenticationRequiredException` for every invalid token without parser detail. |

Tokens carry only identity and session binding. Roles, contacts, passwords, refresh values and OTP data are never claims; roles are reloaded from the current User on each request.

## Verification

`JwtAccessTokenCodecTest` covers the implementation; `CurrentUserAuthenticationTest` and `AuthenticationServiceTest` use the interface as a seam.
