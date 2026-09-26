# `AuthenticationRequiredException.java`

Source: [`src/main/java/bd/mediwish/auth/AuthenticationRequiredException.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthenticationRequiredException.java)

Public, message-less exception meaning "no valid credential". It is thrown for invalid, expired or tampered access tokens (`AccessTokenCodec.verify`), inactive or mismatched sessions, unusable refresh cookies, rejected refresh rotation and a missing or unusable current User. Callers cannot tell which case occurred. `SessionReplayException` is its only subtype.

`ApiExceptionHandler` maps it to `401 AUTHENTICATION_REQUIRED`. `BearerAccessTokenFilter` catches it and writes the same `401` with a `WWW-Authenticate: Bearer` challenge. `AuthController.refresh` also clears the refresh cookie.
