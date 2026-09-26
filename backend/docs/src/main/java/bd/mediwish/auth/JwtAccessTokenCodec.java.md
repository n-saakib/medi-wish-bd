# `JwtAccessTokenCodec.java`

Source: [`src/main/java/bd/mediwish/auth/JwtAccessTokenCodec.java`](../../../../../../../src/main/java/bd/mediwish/auth/JwtAccessTokenCodec.java)

## Purpose

Package-private JJWT implementation of `AccessTokenCodec` using fixed HS256 access tokens.

## Behavior

- **Key.** The constructor decodes `app.auth.jwt-secret` as Base64 and builds the HMAC key once. A missing, non-Base64 or shorter-than-32-byte secret fails startup with `IllegalStateException("auth JWT secret must be Base64 of at least 32 bytes")`; the cause is dropped because a decoder message could quote part of the secret.
- **Issue.** Writes `iss`, `aud`, `sub` (User ID), `jti` (random UUID), `sid` (session ID), `typ=access+jwt`, `iat` and `exp = iat + access lifetime` from the injected clock, signed with HS256.
- **Verify.** The parser accepts only `Jwts.SIG.HS256` with this key, requires the configured issuer and audience and `typ=access+jwt`, and checks expiry against the injected clock. The codec additionally requires `sub`, `sid`, `jti`, `exp` and `iat`, and rejects an `iat` later than now. Any JJWT or argument failure, including non-UUID `sub` or `sid`, becomes `AuthenticationRequiredException`.

Unsigned, differently keyed, non-HS256, expired and tampered tokens fail closed without parser detail reaching HTTP responses or logs.

## Verification

`JwtAccessTokenCodecTest` covers the issued claims, expiry with the injected clock, each missing required claim, wrong issuer, audience or type, future `iat`, tampered, unsigned, foreign-key and non-HS256 tokens, and startup failure for unusable secrets without quoting them.
