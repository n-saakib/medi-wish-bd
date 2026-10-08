# `RegistrationIT.java`

Source: [`src/test/java/bd/mediwish/auth/RegistrationIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/RegistrationIT.java)

## Purpose

`POST /api/auth/register` on the shared context: the normalized User has an argon2id verifier and only the `CUSTOMER` role; caller-supplied roles are ignored. Two Users without an email can each sign in. Invalid P12 identifier formats (username beyond 20 characters, mobile other than 11 ASCII digits, single-label or malformed email, oversized local or domain labels), invalid passwords and malformed JSON are rejected without creating a User. A taken username, mobile or email in another case is a bounded `409` duplicate; racing registrations of one identifier create exactly one User.

## Verification

Parameterized registration cases share the guarded PostgreSQL test schema. Captured logs are checked for tracked secrets after each case. The P12 fixture additions have not yet had a dedicated integration run in this slice.

Verified 2026-09-27 on `ed1e006`: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
