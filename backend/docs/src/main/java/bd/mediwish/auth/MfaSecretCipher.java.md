# `MfaSecretCipher.java`

Source: [`src/main/java/bd/mediwish/auth/MfaSecretCipher.java`](../../../../../../../src/main/java/bd/mediwish/auth/MfaSecretCipher.java)

## Purpose

Package-private component that encrypts authenticator seeds at rest with AES-256-GCM (Ticket 06 D6). The key is `app.auth.mfa.secret-key`, bound from `APP_AUTH_MFA_SECRET_KEY`.

## Behavior

| Member | Behavior |
| --- | --- |
| Constructor | Base64-decodes the trimmed key and requires exactly 32 bytes; a missing, non-Base64 or wrong-length key fails startup with `IllegalStateException("auth MFA secret key must be Base64 of exactly 32 bytes")` and no cause, so no part of the key is quoted. |
| `encrypt(factorId, seed)` | Uses a fresh random 12-byte nonce and a 128-bit tag, with the factor ID's 16 bytes as associated data, and returns `Sealed(ciphertext, nonce)`. |
| `decrypt(factorId, ciphertext, nonce)` | Returns the seed, or throws `IllegalStateException("authenticator seed could not be processed")` when the ciphertext, the nonce or the factor ID differs, so a seed copied to another factor row cannot be opened. |

Rotating the key makes every stored seed undecryptable, so staff must enroll again; `.env.example` says so. The key is kept separate from the JWT secret.

## Verification

`MfaSecretCipherTest` covers round trip, binding to the factor ID, altered ciphertext or nonce, fresh nonces and the startup key rule. `StaffMfaIT` checks that the stored ciphertext does not contain the Base32 seed.
