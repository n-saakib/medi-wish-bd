# `AuthPropertiesTest.java`

Source: [`src/test/java/bd/mediwish/auth/AuthPropertiesTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/AuthPropertiesTest.java)

## Purpose

Unit test of `AuthProperties`: a missing, zero, negative or sub-second access or refresh token lifetime fails with a named message and one second is accepted; a missing MFA block, a blank MFA issuer, any MFA duration below one second and `max-failed-attempts` below one each fail with a named message, and the minimum values are accepted.

## Verification

2 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
