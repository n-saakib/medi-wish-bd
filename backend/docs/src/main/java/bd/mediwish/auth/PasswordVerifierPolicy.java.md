# `PasswordVerifierPolicy.java`

Source: [`src/main/java/bd/mediwish/auth/PasswordVerifierPolicy.java`](../../../../../../../src/main/java/bd/mediwish/auth/PasswordVerifierPolicy.java)

## Purpose

Auth-owned predicate for persisted Argon2 password verifier state. It accepts the Ticket 02 legacy Argon2id v19 profile (`m=16384,t=2,p=1`) and the ADR-0019 profile used for new hashes (`m=19456,t=2,p=1`), with a 16-byte salt and a 32-byte hash. Other algorithms, versions, work factors, salt/hash lengths and malformed encodings fail closed without matching a password or exposing the stored verifier.

## Use cases

- `CurrentUserAuthentication` fails closed before returning a current principal when a persisted verifier is missing or malformed.
- `AuthenticationService.refresh` rejects the rotated session and revokes its family when the user credential state is unusable.
- `SecurityConfiguration` reuses the configured encoder's non-matching parser hook to fail startup for an unusable dummy verifier.

The policy preserves verification of Ticket 02's stored hashes while the configured encoder applies ADR-0019 to new hashes. It does not rewrite existing verifiers, log credential state or add a second password encoder. OTP, recovery and other credential flows remain outside this boundary.

## Verification

`PasswordVerifierPolicyTest` covers null, blank, malformed, bounded valid and encoder-aware values. Auth unit and PostgreSQL journeys cover fail-closed current-user and refresh behavior without printing verifier values.
