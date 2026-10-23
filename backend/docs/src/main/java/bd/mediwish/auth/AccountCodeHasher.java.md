# `AccountCodeHasher.java`

Source: [AccountCodeHasher.java](../../../../../../../src/main/java/bd/mediwish/auth/AccountCodeHasher.java)

HMAC-SHA256 uses the required independent Recovery key. Code input includes purpose, challenge UUID and code; typed-address limit keys use the separate reset-address prefix and contain no address. Each operation creates its own Mac, avoiding mutable shared cryptographic state. Fixed-length verifiers are compared with MessageDigest.isEqual. The unit vector was calculated independently; assertion diagnostics omit verifier values.
