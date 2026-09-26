# `PasswordVerifierPolicy.java`

Source: [`src/main/java/bd/mediwish/auth/PasswordVerifierPolicy.java`](../../../../../../../src/main/java/bd/mediwish/auth/PasswordVerifierPolicy.java)

## Purpose

Package-private static predicate for persisted Argon2 password verifiers. `isUsable(verifier)` parses the stored value without hashing anything, so corrupted credential state is rejected without paying the password-hashing cost.

## Rule

A verifier is usable only when it has the form `$argon2id$v=19$m=<m>,t=2,p=1$<salt>$<hash>` where `m` is `16384` (the Ticket 02 legacy profile) or `19456` (the ADR-0019 profile `AuthCoreConfiguration` uses for new hashes), and the Base64 salt and hash decode to 16 and 32 bytes. Other algorithms, versions, work factors, lengths and malformed encodings are unusable. The input is the non-null `users.password_hash` value.

## Use cases

- `AuthenticationService.signIn` compares against the dummy verifier instead of an unusable stored one.
- `AuthenticationService.refresh` revokes the rotated session when the User's verifier is unusable.
- `CurrentUserAuthentication` rejects the bearer principal when the verifier is unusable.

The policy never rewrites verifiers or logs credential state.

## Verification

`PasswordVerifierPolicyTest` accepts both supported profiles and rejects blank, malformed and wrong-length values and other algorithms, versions and costs.
