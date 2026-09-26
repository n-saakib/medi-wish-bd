package bd.mediwish.auth;

import java.util.UUID;

public interface AccessTokenCodec {
    IssuedAccessToken issue(UUID userId, UUID sessionId);

    /** Returns the verified claims, or throws {@link AuthenticationRequiredException}. */
    AccessTokenClaims verify(String token);

    record IssuedAccessToken(String token, long expiresInSeconds) {}

    record AccessTokenClaims(UUID userId, UUID sessionId) {}
}
