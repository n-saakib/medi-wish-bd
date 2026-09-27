# `JwtAccessTokenCodecTest.java`

Source: [`src/test/java/bd/mediwish/auth/JwtAccessTokenCodecTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/JwtAccessTokenCodecTest.java)

## Purpose

Checks the issued identity/session claims, rejection of signed tokens missing any required claim, future-`iat` and expired-token rejection using the injected clock, and deterministic payload tamper rejection. Issuer/audience pinning, rejection of `alg=none`, a different HS256 key, HS512 even with the configured key, and an HS256 secret below the 32-byte minimum are also covered. `AuthProperties` is built with `TestAuthSettings.mfa()`. Session ownership is checked separately by `SessionServiceTest`; session-family expiry and validly signed tokens whose `sub` or `sid` alone was changed are exercised at the real HTTP/PostgreSQL seam in `SessionIT` and `ProfileIT`.

## Verification

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.
