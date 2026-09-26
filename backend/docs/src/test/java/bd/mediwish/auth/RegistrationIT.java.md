# `RegistrationIT.java`

Source: [`src/test/java/bd/mediwish/auth/RegistrationIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/RegistrationIT.java)

## Purpose

`POST /api/auth/register` on the shared context: the normalized User with an argon2id verifier and only the `CUSTOMER` role; caller-supplied roles are ignored, so registration cannot assign staff roles; two registrations without an email, each of which signs in; invalid input, including a username without a letter (A3), a password of 5 or 31 characters and malformed JSON, is rejected without creating a User; a taken username, mobile or email in another case is a `409` duplicate, and the owner still signs in by email; and racing registrations of one mobile, one normalized username or one email in different case create exactly one User.

## Verification

18 tests; the captured logs are checked for tracked secrets after each.

Verified 2026-09-27 on `ed1e006`: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
