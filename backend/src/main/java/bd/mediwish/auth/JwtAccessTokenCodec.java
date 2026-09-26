package bd.mediwish.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.JwtParser;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

@Component
final class JwtAccessTokenCodec implements AccessTokenCodec {
    private static final String TYPE = "access+jwt";

    private final AuthProperties properties;
    private final Clock clock;
    private final SecretKey key;
    private final JwtParser parser;

    JwtAccessTokenCodec(AuthProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
        this.key = signingKey(properties.jwtSecret());
        this.parser = Jwts.parser()
                .verifyWith(key)
                .sig().clear().add(Jwts.SIG.HS256).and()
                .requireIssuer(properties.issuer())
                .requireAudience(properties.audience())
                .require("typ", TYPE)
                .clock(() -> Date.from(clock.instant()))
                .build();
    }

    @Override
    public IssuedAccessToken issue(UUID userId, UUID sessionId) {
        Instant issuedAt = clock.instant();
        String token = Jwts.builder()
                .issuer(properties.issuer())
                .audience().add(properties.audience()).and()
                .subject(userId.toString())
                .id(UUID.randomUUID().toString())
                .claim("sid", sessionId.toString())
                .claim("typ", TYPE)
                .issuedAt(Date.from(issuedAt))
                .expiration(Date.from(issuedAt.plus(properties.accessTokenLifetime())))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
        return new IssuedAccessToken(token, properties.accessTokenLifetime().toSeconds());
    }

    @Override
    public AccessTokenClaims verify(String token) {
        try {
            Claims claims = parser.parseSignedClaims(token).getPayload();
            String sessionId = claims.get("sid", String.class);
            Date issuedAt = claims.getIssuedAt();
            // JJWT enforces a present exp without clock skew, but accepts a missing exp and a missing or future iat.
            if (claims.getSubject() == null || sessionId == null || claims.getId() == null
                    || claims.getExpiration() == null || issuedAt == null || issuedAt.toInstant().isAfter(clock.instant())) {
                throw new AuthenticationRequiredException();
            }
            return new AccessTokenClaims(UUID.fromString(claims.getSubject()), UUID.fromString(sessionId));
        } catch (JwtException | IllegalArgumentException exception) {
            throw new AuthenticationRequiredException();
        }
    }

    private static SecretKey signingKey(String secret) {
        try {
            return Keys.hmacShaKeyFor(Decoders.BASE64.decode(secret));
        } catch (JwtException | IllegalArgumentException exception) {
            // The cause is dropped because an invalid-character message would quote part of the secret.
            throw new IllegalStateException("auth JWT secret must be Base64 of at least 32 bytes");
        }
    }
}
