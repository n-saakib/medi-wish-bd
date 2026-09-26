# `SignInIT.java`

Source: [`src/test/java/bd/mediwish/auth/SignInIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/SignInIT.java)

## Purpose

`POST /api/auth/login` on the shared context:

- sign-in by username, verified mobile or email in any case;
- identical generic failures for a wrong password or an unknown identifier;
- an unverified mobile is not an identifier;
- an identifier that is one User's username and another's verified mobile signs in neither, each owner trying their own password;
- one User matched by two fields signs in;
- the database rejects a second User whose email differs only in case (`23505`), and the first still signs in by email;
- invalid requests (malformed JSON, a missing password, a blank identifier, an oversized identifier or password, a body over 16 KiB, `text/plain` with 415) are rejected with `INVALID_REQUEST`;
- a JSON body over 16 KiB sent with a valid CSRF pair to the percent-encoded `/api/auth/%6Cogin` is still rejected with `400 INVALID_REQUEST` (before the shared matcher it skipped the limit and reached sign-in);
- order references, payment keys, guest credentials, request IDs and a random refresh cookie cannot create a session;
- a delivery person signs in and reads their profile.

## Verification

24 tests. On 2026-09-26 the collision test failed under a temporary "username wins" and then a "mobile wins" mutation of `AuthenticationService.resolve`, and passed after the exact revert.

Verified 2026-09-27 on `724b0c8`: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
