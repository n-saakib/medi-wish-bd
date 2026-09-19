# UserSessionRefreshToken

JPA mapping for one refresh-token generation. Only the fixed-length SHA-256 digest is stored; generation is unique within a family, the digest is globally unique and `consumedAt` remains durable for replay detection.
