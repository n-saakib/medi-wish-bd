package bd.mediwish.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
@ConfigurationProperties(prefix = "app.auth")
public class AuthProperties {
    private Duration accessTokenLifetime = Duration.ofMinutes(15);
    private Duration refreshTokenLifetime = Duration.ofDays(30);
    private String issuer = "medi-wish";
    private String audience = "medi-wish-api";
    private String jwtSecret = "";
    private String dummyPasswordVerifier = "";

    public Duration accessTokenLifetime() { return accessTokenLifetime; }
    public Duration refreshTokenLifetime() { return refreshTokenLifetime; }
    public String issuer() { return issuer; }
    public String audience() { return audience; }
    public String jwtSecret() { return jwtSecret; }
    public String dummyPasswordVerifier() { return dummyPasswordVerifier; }

    public void setAccessTokenLifetime(Duration accessTokenLifetime) { this.accessTokenLifetime = accessTokenLifetime; }
    public void setRefreshTokenLifetime(Duration refreshTokenLifetime) { this.refreshTokenLifetime = refreshTokenLifetime; }
    public void setIssuer(String issuer) { this.issuer = issuer; }
    public void setAudience(String audience) { this.audience = audience; }
    public void setJwtSecret(String jwtSecret) { this.jwtSecret = jwtSecret; }
    public void setDummyPasswordVerifier(String dummyPasswordVerifier) { this.dummyPasswordVerifier = dummyPasswordVerifier; }
}
