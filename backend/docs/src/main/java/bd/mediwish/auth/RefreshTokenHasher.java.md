# RefreshTokenHasher

Pure SHA-256 helper for opaque refresh values. It returns exactly 64 lowercase hex characters and rejects blank input; the raw token is never returned by the helper or persisted by the session module.
