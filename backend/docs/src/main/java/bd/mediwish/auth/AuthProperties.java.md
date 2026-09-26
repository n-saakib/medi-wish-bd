# `AuthProperties.java`

Source: [`src/main/java/bd/mediwish/auth/AuthProperties.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthProperties.java)

## Purpose

Public immutable record bound from `app.auth`: `accessTokenLifetime`, `refreshTokenLifetime`, `issuer`, `audience`, `jwtSecret` and `cookie` (nested `Cookie(boolean secure)`). `AuthCoreConfiguration` enables the binding; `application.yaml` supplies `PT15M`, `P30D`, `medi-wish`, `medi-wish-api`, `APP_AUTH_JWT_SECRET` and `APP_AUTH_COOKIE_SECURE` (default `true`).

## Validation

- The compact constructor rejects a missing lifetime or one shorter than one second with `IllegalStateException`, so startup fails. No upper bound is checked.
- `jwtSecret` is validated where `JwtAccessTokenCodec` builds its signing key.
- `cookie.secure` may be `false` only when every active profile is `local` or `test`; `SecurityConfiguration` enforces this when it is constructed.

There is no dummy-verifier setting; `AuthenticationService` generates its own at startup. Error messages never include the secret.

## Verification

`AuthPropertiesTest` covers the lifetime rule; `SecurityConfigurationTest` covers the Secure-cookie profile rule; `JwtAccessTokenCodecTest` covers secret validation.
