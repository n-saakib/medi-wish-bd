# `PasswordVerifierPolicyTest.java`

Source: [`src/test/java/bd/mediwish/auth/PasswordVerifierPolicyTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/PasswordVerifierPolicyTest.java)

## Purpose

Protects the shared persisted-password verifier policy without using real user credentials or a database.

## Verification

`PasswordVerifierPolicy.isUsable` accepts Ticket 02's legacy Argon2id profile (`m=16384`), the `m=19456` profile, and hashes newly encoded by Spring Security's v5.8 Argon2 defaults and by `AuthCoreConfiguration.passwordEncoder()`. It rejects blank, malformed and wrong salt/hash-length values, other Argon2 variants (`argon2i`, `argon2d`), another version, and memory, iteration or parallelism costs outside the accepted profiles. Only synthetic verifiers are used and none is printed.
