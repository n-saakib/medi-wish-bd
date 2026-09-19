package bd.mediwish.auth;

import java.time.Instant;
import java.util.UUID;

public interface AccessTokenCodec {
    IssuedAccessToken issue(UUID userId, UUID sessionId);

    AccessTokenClaims verify(String token);

    record IssuedAccessToken(String token, long expiresInSeconds, Instant expiresAt) {}

    record AccessTokenClaims(
            UUID userId,
            UUID sessionId,
            UUID tokenId,
            Instant issuedAt,
            Instant expiresAt,
            String issuer,
            String audience,
            String type) {}
}
