# `AuthProperties.java`

Source: [`src/main/java/bd/mediwish/auth/AuthProperties.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthProperties.java)

## Purpose

Public immutable record bound from `app.auth`: `accessTokenLifetime`, `refreshTokenLifetime`, `issuer`, `audience`, `jwtSecret`, `cookie` (nested `Cookie(boolean secure)`) `mfa` (nested `Mfa`) and `recovery` (nested `Recovery`). `AuthCoreConfiguration` enables the binding; `application.yaml` supplies `PT15M`, `P30D`, `medi-wish`, `medi-wish-api`, `APP_AUTH_JWT_SECRET`, `APP_AUTH_COOKIE_SECURE` (default `true`) and the MFA defaults below.

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


## Ticket 05 recovery

`Recovery` configures the 15-minute code lifetime (fixed: any `code-lifetime` other than `PT15M` fails startup with `auth recovery code-lifetime must be PT15M`, because both code mail bodies and the frontend verification dialog state 15 minutes), five wrong tries, shared five issues/hour with a 60-second gap, ten address requests/hour and five current-password failures/hour. Its required key decodes to exactly 32 bytes and must differ from decoded JWT and MFA keys. Validation errors and Recovery.toString omit the key.

## Ticket 05 integration

Recovery.maxWrongTries is bounded to one through five, matching the account_codes failed_attempts CHECK; a higher configured limit is rejected at startup.

## Counter retention

Recovery.limitRetention() is the age after which account_code_limits rows are pruned: two hours, or the longest of issueWindow plus issueGap, addressWindow and passwordWindow when that is larger, so a configured window over two hours is never pruned early.
