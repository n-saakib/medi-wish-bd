# `RefreshTokenHasher.java`

Source: [`src/main/java/bd/mediwish/auth/RefreshTokenHasher.java`](../../../../../../../src/main/java/bd/mediwish/auth/RefreshTokenHasher.java)

Package-private static helper. `hash(rawToken)` returns the SHA-256 digest of the value's US-ASCII bytes as 64 lowercase hex characters. `SessionService` stores and looks up only this digest; the raw value is never persisted. It does not validate input: callers pass either a freshly generated value or one that `RefreshCookieAdapter` has already checked. Covered by `RefreshTokenHasherTest`.
