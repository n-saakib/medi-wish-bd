package bd.mediwish.web;

import bd.mediwish.auth.AuthProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Optional;

/** Serializes the opaque refresh credential without exposing cookie policy to the domain layer. */
@Component
public final class RefreshCookieAdapter {
    public static final String COOKIE_NAME = "MW_REFRESH";
    public static final String COOKIE_PATH = "/api/auth";
    public static final int MAX_COOKIE_VALUE_LENGTH = 4096;

    private final Duration lifetime;
    private final boolean secure;

    @Autowired
    public RefreshCookieAdapter(AuthProperties properties,
                                @org.springframework.beans.factory.annotation.Value("${app.auth.cookie.secure:true}")
                                boolean secure) {
        this(properties.refreshTokenLifetime(), secure);
    }

    public RefreshCookieAdapter(Duration lifetime, boolean secure) {
        if (lifetime == null || lifetime.isNegative() || lifetime.isZero()) {
            throw new IllegalArgumentException("refresh cookie lifetime must be positive");
        }
        this.lifetime = lifetime;
        this.secure = secure;
    }

    public Optional<String> read(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return Optional.empty();
        String value = null;
        for (Cookie cookie : cookies) {
            if (!COOKIE_NAME.equals(cookie.getName())) continue;
            if (value != null || cookie.getValue() == null || cookie.getValue().isBlank()
                    || cookie.getValue().length() > MAX_COOKIE_VALUE_LENGTH) {
                return Optional.empty();
            }
            value = cookie.getValue();
        }
        return Optional.ofNullable(value);
    }

    public void set(HttpServletResponse response, String rawValue) {
        if (rawValue == null || rawValue.isBlank() || rawValue.length() > MAX_COOKIE_VALUE_LENGTH) {
            throw new IllegalArgumentException("refresh value is invalid");
        }
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(rawValue, lifetime).toString());
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
    }

    private ResponseCookie cookie(String value, Duration maxAge) {
        return ResponseCookie.from(COOKIE_NAME, value)
                .httpOnly(true)
                .secure(secure)
                .sameSite("Lax")
                .path(COOKIE_PATH)
                .maxAge(maxAge)
                .build();
    }
}
