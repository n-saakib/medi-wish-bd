# `TotpTest.java`

Source: [`src/test/java/bd/mediwish/auth/TotpTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/TotpTest.java)

## Purpose

Unit test of `Totp`: the six RFC 6238 Appendix B SHA1 vectors; codes one step either side of now are accepted and two steps away are not; a code at or before `lastUsedStep` is refused while a later step is accepted; a code from another seed is refused.

## Verification

9 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
