# `AuthPropertiesTest.java`

Source: [`src/test/java/bd/mediwish/auth/AuthPropertiesTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/AuthPropertiesTest.java)

## Purpose

Unit test: a missing, zero, negative or sub-second access or refresh token lifetime fails with a named message; one second is accepted.

## Verification

1 test.

Verified 2026-09-27 on `b26f0c9` plus the Ticket 03.03 changes: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
