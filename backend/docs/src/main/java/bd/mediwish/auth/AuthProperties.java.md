# `AuthProperties.java`

Source: [`src/main/java/bd/mediwish/auth/AuthProperties.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthProperties.java)

## Purpose

Public immutable record bound from `app.auth`: `accessTokenLifetime`, `refreshTokenLifetime`, `issuer`, `audience`, `jwtSecret`, `cookie` (nested `Cookie(boolean secure)`) and `mfa` (nested `Mfa`). `AuthCoreConfiguration` enables the binding; `application.yaml` supplies `PT15M`, `P30D`, `medi-wish`, `medi-wish-api`, `APP_AUTH_JWT_SECRET`, `APP_AUTH_COOKIE_SECURE` (default `true`) and the MFA defaults below.

## Staff MFA settings

| `Mfa` component | Default | Used by |
| --- | --- | --- |
| `issuer` | `Medi Wish` | The `otpauth` label and issuer shown by authenticator apps. |
| `secretKey` | `APP_AUTH_MFA_SECRET_KEY` | `MfaSecretCipher`; Base64 of exactly 32 bytes. |
| `restrictedSessionLifetime` | `PT10M` | Lifetime of a staff password session until it is verified. |
| `enrollmentLifetime` | `PT10M` | How long a pending authenticator can be verified. |
| `maxFailedAttempts` | `5` | Wrong codes that lock verification. |
| `attemptWindow` | `PT15M` | Window in which failures are counted. |
| `lockout` | `PT15M` | How long verification stays locked. |

## Validation

- The compact constructor rejects a missing lifetime or one shorter than one second with `IllegalStateException`, so startup fails. No upper bound is checked. A missing `mfa` block fails with `auth MFA settings are required`.
- `Mfa` rejects a blank issuer, any of its four durations below one second and `maxFailedAttempts` below one, each with a named message.
- `jwtSecret` is validated where `JwtAccessTokenCodec` builds its signing key; `mfa.secretKey` where `MfaSecretCipher` builds its key.
- `cookie.secure` may be `false` only when every active profile is `local` or `test`; `SecurityConfiguration` enforces this when it is constructed.

There is no dummy-verifier setting; `AuthenticationService` generates its own at startup. Error messages never include a secret.

## Verification

`AuthPropertiesTest` covers the token lifetime rule and every MFA setting rule; `SecurityConfigurationTest` covers the Secure-cookie profile rule; `JwtAccessTokenCodecTest` and `MfaSecretCipherTest` cover secret and key validation. Unit tests build the record through `TestAuthSettings`.
