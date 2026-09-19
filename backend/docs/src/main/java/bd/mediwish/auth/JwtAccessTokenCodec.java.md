# JwtAccessTokenCodec

JJWT `0.13.0` adapter implementing fixed HS256 access tokens. It requires a Base64 secret of at least 32 decoded bytes, validates issuer/audience/type, uses an injected clock for expiry, requires identity/session/time claims and rejects sensitive claim names. It never selects an algorithm from token input.
