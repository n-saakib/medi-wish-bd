# `AuthCoreConfiguration.java`

Source: [`src/main/java/bd/mediwish/auth/AuthCoreConfiguration.java`](../../../../../../../src/main/java/bd/mediwish/auth/AuthCoreConfiguration.java)

## Purpose

Auth-owned Spring configuration. It enables binding of `AuthProperties` and provides the infrastructure beans the auth and user features share.

| Bean | Behavior |
| --- | --- |
| `passwordEncoder()` | Argon2id with a 16-byte salt, 32-byte hash, parallelism 1, 19,456 KiB memory and 2 iterations (ADR-0019). `UserService` uses it for new hashes; `AuthenticationService` uses it for matching and for its startup dummy verifier. Legacy `m=16384` hashes still verify because the encoder reads the parameters from the stored value. |
| `authClock()` | UTC `Clock` for token, session and cookie expiry, injectable for deterministic tests. |
| `authSecureRandom()` | `SecureRandom` for refresh-value generation. |

The web package does not own password hashing.

## Verification

`AuthenticationServiceTest` checks that the dummy verifier is produced with the production encoder profile; `UserServiceTest` and the PostgreSQL journeys exercise hashing and matching.
