# `AuthPropertiesTest.java`

Source: [`src/test/java/bd/mediwish/auth/AuthPropertiesTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/AuthPropertiesTest.java)

## Purpose

Unit test of `AuthProperties`: a missing, zero, negative or sub-second access or refresh token lifetime fails with a named message and one second is accepted; a missing MFA block, a blank MFA issuer, any MFA duration below one second and `max-failed-attempts` below one each fail with a named message, and the minimum values are accepted.

## Verification

2 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.


## Ticket 05 recovery

Recovery-key checks reject missing, malformed and wrong-sized keys, and reject reuse of the MFA key. Existing lifetime and MFA settings checks retain their behavior with the required Recovery fixture.

## Ticket 05 integration

The recovery boundary additionally rejects maxWrongTries greater than the persisted five-attempt bound, and rejects a missing code lifetime or any value other than the 15 minutes stated in mail and page copy.

## Counter retention

limitRetention() is two hours with the defaults and follows a longer issue window plus gap, address window or password window.
