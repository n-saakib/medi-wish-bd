# JwtAccessTokenCodec

JJWT `0.13.0` adapter implementing fixed HS256 access tokens. It requires a Base64 secret of at least 32 decoded bytes, validates issuer/audience/type, uses an injected clock for expiry, requires identity/session/time claims and rejects sensitive claim names. Verification explicitly allow-lists `Jwts.SIG.HS256`, so unsigned, differently keyed and non-HS256 tokens fail closed; the conservative substring-based sensitive-claim check remains intentional privacy defense.
