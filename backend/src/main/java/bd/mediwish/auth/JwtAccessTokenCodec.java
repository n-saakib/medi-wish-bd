package bd.mediwish.auth;

import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Component
public final class JwtAccessTokenCodec implements AccessTokenCodec {
    private static final String TYPE = "access+jwt";
    private static final Set<String> FORBIDDEN_CLAIM_WORDS = Set.of(
            "password", "mobile", "email", "role", "refresh", "otp");

    private final AuthProperties properties;
    private final Clock clock;

    public JwtAccessTokenCodec(AuthProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public IssuedAccessToken issue(UUID userId, UUID sessionId) {
        Instant issuedAt = clock.instant();
        Instant expiresAt = issuedAt.plus(properties.accessTokenLifetime());
        if (userId == null || sessionId == null || !expiresAt.isAfter(issuedAt)) {
            throw new IllegalArgumentException("invalid access-token input");
        }
        String token = Jwts.builder()
                .issuer(properties.issuer())
                .audience().add(properties.audience()).and()
                .subject(userId.toString())
                .id(UUID.randomUUID().toString())
                .claim("sid", sessionId.toString())
                .claim("typ", TYPE)
                .issuedAt(Date.from(issuedAt))
                .expiration(Date.from(expiresAt))
                .signWith(signingKey(), Jwts.SIG.HS256)
                .compact();
        return new IssuedAccessToken(token, properties.accessTokenLifetime().toSeconds(), expiresAt);
    }

    @Override
    public AccessTokenClaims verify(String token) {
        if (token == null || token.isBlank()) throw new InvalidAccessTokenException();
        try {
            var payload = Jwts.parser()
                    .verifyWith(signingKey())
                    .requireIssuer(properties.issuer())
                    .requireAudience(properties.audience())
                    .clock(() -> Date.from(clock.instant()))
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            if (!TYPE.equals(payload.get("typ", String.class)) || hasForbiddenClaim(payload.keySet())) {
                throw new InvalidAccessTokenException();
            }
            Instant now = clock.instant();
            Instant issuedAt = requiredInstant(payload.getIssuedAt());
            Instant expiresAt = requiredInstant(payload.getExpiration());
            if (issuedAt.isAfter(now) || !expiresAt.isAfter(now)) throw new InvalidAccessTokenException();
            UUID userId = requiredUuid(payload.getSubject());
            UUID sessionId = requiredUuid(payload.get("sid", String.class));
            UUID tokenId = requiredUuid(payload.getId());
            return new AccessTokenClaims(userId, sessionId, tokenId, issuedAt, expiresAt,
                    payload.getIssuer(), properties.audience(), TYPE);
        } catch (InvalidAccessTokenException exception) {
            throw exception;
        } catch (JwtException | IllegalArgumentException exception) {
            throw new InvalidAccessTokenException();
        }
    }

    private SecretKey signingKey() {
        String encoded = properties.jwtSecret();
        if (encoded == null || encoded.isBlank()) throw new IllegalStateException("auth JWT secret is not configured");
        try {
            byte[] decoded = Decoders.BASE64.decode(encoded);
            if (decoded.length < 32) throw new IllegalStateException("auth JWT secret is too short");
            return Keys.hmacShaKeyFor(decoded);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("auth JWT secret is invalid");
        }
    }

    private boolean hasForbiddenClaim(Set<String> claimNames) {
        return claimNames.stream()
                .map(name -> name.toLowerCase(Locale.ROOT))
                .anyMatch(name -> FORBIDDEN_CLAIM_WORDS.stream().anyMatch(name::contains));
    }

    private Instant requiredInstant(Date value) {
        if (value == null) throw new InvalidAccessTokenException();
        return value.toInstant();
    }

    private UUID requiredUuid(String value) {
        if (value == null || value.isBlank()) throw new InvalidAccessTokenException();
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException exception) {
            throw new InvalidAccessTokenException();
        }
    }
}
