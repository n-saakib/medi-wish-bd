# AuthCoreConfiguration

Provides the UTC `Clock` and `SecureRandom` infrastructure used by the auth core. Both are injectable so expiry, replay and token-generation tests can be deterministic without sleeping or replacing cryptographic behavior in web code.
