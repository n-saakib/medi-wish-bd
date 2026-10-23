package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import io.jsonwebtoken.JwtBuilder;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;
import java.util.function.UnaryOperator;

import javax.crypto.SecretKey;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtAccessTokenCodecTest {
    private static final Instant NOW = Instant.parse("2026-09-19T10:00:00Z");
    private static final String SECRET = Base64.getEncoder().encodeToString(new byte[32]);
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID SESSION_ID = UUID.randomUUID();

    private final JwtAccessTokenCodec codec = codecAt(NOW, SECRET);

    @Test
    void issuesOnlyTheIdentityAndSessionClaimsAndVerifiesThem() {
        var issued = codec.issue(USER_ID, SESSION_ID);
        var rawClaims = Jwts.parser().verifyWith(key(SECRET)).clock(() -> Date.from(NOW)).build()
                .parseSignedClaims(issued.token()).getPayload();

        assertThat(issued.expiresInSeconds()).isEqualTo(900);
        assertThat(codec.verify(issued.token())).isEqualTo(new AccessTokenCodec.AccessTokenClaims(USER_ID, SESSION_ID));
        assertThat(rawClaims.keySet()).containsExactlyInAnyOrder("iss", "aud", "sub", "sid", "jti", "iat", "exp", "typ");
        assertThat(rawClaims.getExpiration().toInstant()).isEqualTo(NOW.plusSeconds(900));
    }

    @Test
    void rejectsAnExpiredTokenUsingTheInjectedClock() {
        String token = codec.issue(USER_ID, SESSION_ID).token();

        assertThat(codecAt(NOW.plusSeconds(899), SECRET).verify(token).userId()).isEqualTo(USER_ID);
        assertThatThrownBy(() -> codecAt(NOW.plusSeconds(901), SECRET).verify(token))
                .isInstanceOf(AuthenticationRequiredException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"iss", "aud", "sub", "sid", "jti", "iat", "exp", "typ"})
    void rejectsASignedTokenMissingARequiredClaim(String claim) {
        String token = signed(builder -> builder.claims().delete(claim).and());

        assertThatThrownBy(() -> codec.verify(token)).isInstanceOf(AuthenticationRequiredException.class);
    }

    @Test
    void rejectsSignedTokensWithTheWrongIssuerAudienceTypeOrAFutureIssueTime() {
        for (String token : new String[]{
                signed(builder -> builder.issuer("wrong-issuer")),
                signed(builder -> builder.audience().single("wrong-audience")),
                signed(builder -> builder.claim("typ", "refresh+jwt")),
                signed(builder -> builder.issuedAt(Date.from(NOW.plusSeconds(1))))}) {
            assertThatThrownBy(() -> codec.verify(token)).isInstanceOf(AuthenticationRequiredException.class);
        }
    }

    @Test
    void rejectsTamperedUnsignedForeignKeyAndNonHs256Tokens() {
        String issued = codec.issue(USER_ID, SESSION_ID).token();
        String[] segments = issued.split("\\.", -1);
        String unsignedHeader = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8));
        byte[] foreignKey = new byte[32];
        Arrays.fill(foreignKey, (byte) 1);
        String longSecret = Base64.getEncoder().encodeToString(new byte[64]);

        for (String token : new String[]{
                segments[0] + "." + segments[1] + "." + segments[2].substring(1) + "A",
                unsignedHeader + "." + segments[1] + ".",
                claims().signWith(Keys.hmacShaKeyFor(foreignKey), Jwts.SIG.HS256).compact(),
                "not-a-jwt",
                ""}) {
            assertThatThrownBy(() -> codec.verify(token)).isInstanceOf(AuthenticationRequiredException.class);
        }
        String hs512 = claims().signWith(key(longSecret), Jwts.SIG.HS512).compact();
        assertThatThrownBy(() -> codecAt(NOW, longSecret).verify(hs512)).isInstanceOf(AuthenticationRequiredException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"AAAAAAAAAAAAAAAAAAAAAA==", "not base64 secret-value!"})
    void anUnusableSecretFailsStartupWithoutQuotingIt(String secret) {
        assertThatThrownBy(() -> codecAt(NOW, secret))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("auth JWT secret must be Base64 of at least 32 bytes")
                .hasNoCause();
    }

    private static JwtAccessTokenCodec codecAt(Instant now, String secret) {
        var properties = new AuthProperties(Duration.ofMinutes(15), Duration.ofDays(30), "medi-wish", "medi-wish-api",
                secret, new AuthProperties.Cookie(true), TestAuthSettings.mfa(), TestAuthSettings.recovery());
        return new JwtAccessTokenCodec(properties, Clock.fixed(now, ZoneOffset.UTC));
    }

    private static SecretKey key(String secret) {
        return Keys.hmacShaKeyFor(Base64.getDecoder().decode(secret));
    }

    /** The claims the codec issues, before signing. */
    private static JwtBuilder claims() {
        return Jwts.builder()
                .issuer("medi-wish")
                .audience().add("medi-wish-api").and()
                .subject(USER_ID.toString())
                .id(UUID.randomUUID().toString())
                .claim("sid", SESSION_ID.toString())
                .claim("typ", "access+jwt")
                .issuedAt(Date.from(NOW))
                .expiration(Date.from(NOW.plusSeconds(900)));
    }

    private static String signed(UnaryOperator<JwtBuilder> change) {
        return change.apply(claims()).signWith(key(SECRET), Jwts.SIG.HS256).compact();
    }
}
