# `MfaSecretCipherTest.java`

Source: [`src/test/java/bd/mediwish/auth/MfaSecretCipherTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/MfaSecretCipherTest.java)

## Purpose

Unit test of `MfaSecretCipher` over `TestAuthSettings`: a sealed seed does not appear in the ciphertext and opens only for its own factor ID; an altered ciphertext or nonce is rejected; every seal uses a fresh nonce; startup fails with the fixed message and no cause for an empty, non-Base64, short or 33-byte key; and the synthetic test key is exactly 32 bytes.

## Verification

8 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
