# `RegistrationIT.java`

Source: [`src/test/java/bd/mediwish/auth/RegistrationIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/RegistrationIT.java)

## Purpose

`POST /api/auth/register` on the shared context: the normalized User with an argon2id verifier and only the `CUSTOMER` role; caller-supplied roles are ignored, so registration cannot assign staff roles; registration without an email; invalid input, including a username without a letter (A3), a password of 5 or 31 characters and malformed JSON, is rejected without creating a User; a taken username or mobile is a duplicate; and racing registrations of one mobile or one normalized username create exactly one User.

## Verification

15 tests; the captured logs are checked for tracked secrets after each.

Verified 2026-09-26 on `45cbc7e` plus the uncommitted T4 worktree: `./mvnw.cmd -o verify` passed 168 unit and 105 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 168 and 105 with no skip.
