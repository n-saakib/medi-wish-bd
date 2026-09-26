# `PasswordVerifierPolicyTest.java`

Source: [`src/test/java/bd/mediwish/auth/PasswordVerifierPolicyTest.java`](../../../../../../src/test/java/bd/mediwish/auth/PasswordVerifierPolicyTest.java)

## Purpose

Protects the shared persisted-password verifier policy without using real user credentials or a database.

## Verification

The tests reject null, blank, malformed, non-Argon2id/version, unsupported-cost and wrong salt/hash-length values; accept both Ticket 02's legacy profile and the ADR-0019 profile; and prove encoder-aware validation uses `upgradeEncoding` rather than a password match. `SecurityConfigurationTest` also proves newly encoded hashes use the ADR-0019 profile and the configured encoder verifies a Ticket 02 hash. No verifier value is printed.
