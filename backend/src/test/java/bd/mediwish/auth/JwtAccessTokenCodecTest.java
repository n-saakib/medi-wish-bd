package bd.mediwish.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;

import javax.crypto.SecretKey;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtAccessTokenCodecTest {
    private static final Instant NOW = Instant.parse("2026-09-19T10:00:00Z");
    private static final String SECRET = Base64.getEncoder().encodeToString(new byte[32]);

    @Test
    void issuesOnlyTheRequiredIdentityAndSessionClaims() {
        var properties = properties();
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();

        var issued = codec.issue(userId, sessionId);
        var claims = codec.verify(issued.token());

        assertThat(claims.userId()).isEqualTo(userId);
        assertThat(claims.sessionId()).isEqualTo(sessionId);
        assertThat(claims.issuedAt()).isEqualTo(NOW);
        assertThat(claims.expiresAt()).isEqualTo(NOW.plusSeconds(900));
        assertThat(claims.type()).isEqualTo("access+jwt");
        assertThat(issued.expiresInSeconds()).isEqualTo(900);
    }

    @Test
    void rejectsExpiredTokensUsingTheInjectedClock() {
        var properties = properties();
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        String token = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC))
                .issue(userId, sessionId).token();

        var expiredCodec = new JwtAccessTokenCodec(properties,
                Clock.fixed(NOW.plusSeconds(901), ZoneOffset.UTC));

        assertThatThrownBy(() -> expiredCodec.verify(token))
                .isInstanceOf(InvalidAccessTokenException.class);
    }

    @Test
    void rejectsTamperingAndWrongIssuerOrAudience() {
        var properties = properties();
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        String issued = codec.issue(userId, sessionId).token();
        String tampered = issued.substring(0, issued.length() - 1)
                + (issued.endsWith("A") ? "B" : "A");

        assertThatThrownBy(() -> codec.verify(tampered))
                .isInstanceOf(InvalidAccessTokenException.class);
        assertThatThrownBy(() -> codec.verify(signedToken(userId, sessionId, "wrong-issuer", "medi-wish-api")))
                .isInstanceOf(InvalidAccessTokenException.class);
        assertThatThrownBy(() -> codec.verify(signedToken(userId, sessionId, "medi-wish", "wrong-audience")))
                .isInstanceOf(InvalidAccessTokenException.class);
    }

    @Test
    void rejectsASecretShorterThanTheHs256Minimum() {
        var properties = properties();
        properties.setJwtSecret(Base64.getEncoder().encodeToString(new byte[16]));

        assertThatThrownBy(() -> new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC))
                .issue(UUID.randomUUID(), UUID.randomUUID()))
                .isInstanceOf(IllegalStateException.class);
    }

    private AuthProperties properties() {
        var properties = new AuthProperties();
        properties.setJwtSecret(SECRET);
        return properties;
    }

    private String signedToken(UUID userId, UUID sessionId, String issuer, String audience) {
        return Jwts.builder()
                .issuer(issuer)
                .audience().add(audience).and()
                .subject(userId.toString())
                .id(UUID.randomUUID().toString())
                .claim("sid", sessionId.toString())
                .claim("typ", "access+jwt")
                .issuedAt(Date.from(NOW))
                .expiration(Date.from(NOW.plusSeconds(900)))
                .signWith(signingKey(), Jwts.SIG.HS256)
                .compact();
    }

    private SecretKey signingKey() {
        return Keys.hmacShaKeyFor(Base64.getDecoder().decode(SECRET));
    }
}
