package bd.mediwish.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.MacAlgorithm;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.Set;
import java.util.UUID;

import javax.crypto.SecretKey;

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
        var rawClaims = Jwts.parser()
                .clock(() -> Date.from(NOW))
                .verifyWith(Keys.hmacShaKeyFor(Base64.getDecoder().decode(SECRET)))
                .build()
                .parseSignedClaims(issued.token())
                .getPayload();

        assertThat(claims.userId()).isEqualTo(userId);
        assertThat(claims.sessionId()).isEqualTo(sessionId);
        assertThat(claims.issuedAt()).isEqualTo(NOW);
        assertThat(claims.expiresAt()).isEqualTo(NOW.plusSeconds(900));
        assertThat(claims.type()).isEqualTo("access+jwt");
        assertThat(issued.expiresInSeconds()).isEqualTo(900);
        assertThat(rawClaims.keySet()).containsExactlyInAnyOrder(
                "iss", "aud", "sub", "sid", "jti", "iat", "exp", "typ");
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
    void rejectsSignedTokensMissingAnyRequiredClaim() {
        var properties = properties();
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();

        for (String claim : Set.of("iss", "aud", "sub", "sid", "jti", "iat", "exp", "typ")) {
            String token = signedToken(userId, sessionId, properties.issuer(), properties.audience(),
                    Jwts.SIG.HS256, signingKey(), Set.of(claim), NOW, NOW.plusSeconds(900));

            assertThatThrownBy(() -> codec.verify(token))
                    .as("token without required %s claim", claim)
                    .isInstanceOf(InvalidAccessTokenException.class);
        }
    }

    @Test
    void rejectsAccessTokensIssuedInTheFuture() {
        var properties = properties();
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        String token = signedToken(UUID.randomUUID(), UUID.randomUUID(), properties.issuer(), properties.audience(),
                Jwts.SIG.HS256, signingKey(), Set.of(), NOW.plusSeconds(1), NOW.plusSeconds(901));

        assertThatThrownBy(() -> codec.verify(token))
                .isInstanceOf(InvalidAccessTokenException.class);
    }

    @Test
    void rejectsTamperingAndWrongIssuerOrAudience() {
        var properties = properties();
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        String issued = codec.issue(userId, sessionId).token();
        String tampered = tamperSubject(issued);

        assertThatThrownBy(() -> codec.verify(tampered))
                .isInstanceOf(InvalidAccessTokenException.class);
        assertThatThrownBy(() -> codec.verify(signedToken(userId, sessionId, "wrong-issuer", "medi-wish-api")))
                .isInstanceOf(InvalidAccessTokenException.class);
        assertThatThrownBy(() -> codec.verify(signedToken(userId, sessionId, "medi-wish", "wrong-audience")))
                .isInstanceOf(InvalidAccessTokenException.class);
    }

    @Test
    void verifiesAChangedSessionClaimWhenTheAlteredJwtIsValidlyResigned() {
        var properties = properties();
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        UUID originalSessionId = UUID.randomUUID();
        UUID alteredSessionId = UUID.randomUUID();
        String issued = codec.issue(userId, originalSessionId).token();

        var claims = codec.verify(resignWithSessionId(issued, alteredSessionId));

        assertThat(claims.userId()).isEqualTo(userId);
        assertThat(claims.sessionId()).isEqualTo(alteredSessionId).isNotEqualTo(originalSessionId);
    }

    @Test
    void rejectsUnsignedAccessTokens() {
        var properties = properties();
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        String issued = codec.issue(UUID.randomUUID(), UUID.randomUUID()).token();
        String[] segments = issued.split("\\.", -1);
        String unsignedHeader = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8));
        String unsigned = unsignedHeader + "." + segments[1] + ".";

        assertThatThrownBy(() -> codec.verify(unsigned))
                .isInstanceOf(InvalidAccessTokenException.class);
    }

    @Test
    void rejectsAccessTokensSignedWithADifferentHs256Key() {
        var properties = properties();
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        String token = signedToken(userId, sessionId, properties.issuer(), properties.audience(),
                Jwts.SIG.HS256, differentSigningKey());

        assertThatThrownBy(() -> codec.verify(token))
                .isInstanceOf(InvalidAccessTokenException.class);
    }

    @Test
    void rejectsNonHs256AccessTokensEvenWithTheConfiguredKey() {
        String secret = Base64.getEncoder().encodeToString(new byte[64]);
        var properties = properties(secret);
        var codec = new JwtAccessTokenCodec(properties, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        String token = signedToken(userId, sessionId, properties.issuer(), properties.audience(),
                Jwts.SIG.HS512, signingKey(secret));

        assertThatThrownBy(() -> codec.verify(token))
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
        return properties(SECRET);
    }

    private AuthProperties properties(String secret) {
        var properties = new AuthProperties();
        properties.setJwtSecret(secret);
        return properties;
    }

    private String signedToken(UUID userId, UUID sessionId, String issuer, String audience) {
        return signedToken(userId, sessionId, issuer, audience, Jwts.SIG.HS256, signingKey());
    }

    private String signedToken(UUID userId, UUID sessionId, String issuer, String audience,
                               MacAlgorithm algorithm, SecretKey key) {
        return signedToken(userId, sessionId, issuer, audience, algorithm, key, Set.of(), NOW, NOW.plusSeconds(900));
    }

    private String signedToken(UUID userId, UUID sessionId, String issuer, String audience,
                               MacAlgorithm algorithm, SecretKey key, Set<String> omittedClaims,
                               Instant issuedAt, Instant expiresAt) {
        var builder = Jwts.builder();
        if (!omittedClaims.contains("iss")) builder.issuer(issuer);
        if (!omittedClaims.contains("aud")) builder.audience().add(audience).and();
        if (!omittedClaims.contains("sub")) builder.subject(userId.toString());
        if (!omittedClaims.contains("jti")) builder.id(UUID.randomUUID().toString());
        if (!omittedClaims.contains("sid")) builder.claim("sid", sessionId.toString());
        if (!omittedClaims.contains("typ")) builder.claim("typ", "access+jwt");
        if (!omittedClaims.contains("iat")) builder.issuedAt(Date.from(issuedAt));
        if (!omittedClaims.contains("exp")) builder.expiration(Date.from(expiresAt));
        return builder.signWith(key, algorithm).compact();
    }

    private SecretKey signingKey() {
        return signingKey(SECRET);
    }

    private SecretKey signingKey(String secret) {
        return Keys.hmacShaKeyFor(Base64.getDecoder().decode(secret));
    }

    private SecretKey differentSigningKey() {
        byte[] bytes = new byte[32];
        Arrays.fill(bytes, (byte) 1);
        return Keys.hmacShaKeyFor(bytes);
    }

    private String tamperSubject(String token) {
        String[] segments = token.split("\\.", -1);
        String payload = new String(Base64.getUrlDecoder().decode(segments[1]), StandardCharsets.UTF_8);
        String subjectMarker = "\"sub\":\"";
        int subjectStart = payload.indexOf(subjectMarker);
        if (subjectStart < 0) throw new AssertionError("issued token has no subject claim");
        int subjectValueStart = subjectStart + subjectMarker.length();
        char replacement = payload.charAt(subjectValueStart) == '0' ? '1' : '0';
        segments[1] = Base64.getUrlEncoder().withoutPadding().encodeToString(
                (payload.substring(0, subjectValueStart) + replacement
                        + payload.substring(subjectValueStart + 1)).getBytes(StandardCharsets.UTF_8));
        return String.join(".", segments);
    }

    private String resignWithSessionId(String token, UUID sessionId) {
        var claims = new HashMap<>(Jwts.parser().verifyWith(signingKey())
                .clock(() -> Date.from(NOW)).build()
                .parseSignedClaims(token).getPayload());
        claims.put("sid", sessionId.toString());
        return Jwts.builder().claims(claims).signWith(signingKey(), Jwts.SIG.HS256).compact();
    }
}
