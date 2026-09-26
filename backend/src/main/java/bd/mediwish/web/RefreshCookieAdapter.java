package bd.mediwish.web;

import bd.mediwish.auth.AuthProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Serializes the opaque refresh credential without exposing cookie policy to the domain layer. */
@Component
public final class RefreshCookieAdapter {
    public static final String COOKIE_NAME = "MW_REFRESH";
    public static final String COOKIE_PATH = "/api/auth";
    public static final int MAX_COOKIE_VALUE_LENGTH = 4096;

    private final Duration maxLifetime;
    private final boolean secure;
    private final Clock clock;

    @Autowired
    public RefreshCookieAdapter(AuthProperties properties,
                                @org.springframework.beans.factory.annotation.Value("${app.auth.cookie.secure:true}")
                                boolean secure, Clock clock) {
        this(properties.refreshTokenLifetime(), secure, clock);
    }

    public RefreshCookieAdapter(Duration maxLifetime, boolean secure) {
        this(maxLifetime, secure, Clock.systemUTC());
    }

    public RefreshCookieAdapter(Duration maxLifetime, boolean secure, Clock clock) {
        if (maxLifetime == null || maxLifetime.isNegative() || maxLifetime.isZero()) {
            throw new IllegalArgumentException("refresh cookie lifetime must be positive");
        }
        if (clock == null) throw new IllegalArgumentException("refresh cookie clock is required");
        this.maxLifetime = maxLifetime;
        this.secure = secure;
        this.clock = clock;
    }

    public Optional<String> read(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return Optional.empty();
        String value = null;
        for (Cookie cookie : cookies) {
            if (!COOKIE_NAME.equals(cookie.getName())) continue;
            if (value != null || !isValidRefreshValue(cookie.getValue())) {
                return Optional.empty();
            }
            value = cookie.getValue();
        }
        return Optional.ofNullable(value);
    }

    public List<String> readForLogout(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return List.of();
        Set<String> values = new LinkedHashSet<>();
        for (Cookie cookie : cookies) {
            String value = cookie.getValue();
            if (COOKIE_NAME.equals(cookie.getName()) && isValidRefreshValue(value)) values.add(value);
        }
        return List.copyOf(values);
    }

    public void set(HttpServletResponse response, String rawValue, Instant expiresAt) {
        validateRefreshValue(rawValue);
        if (expiresAt == null) throw new IllegalArgumentException("refresh expiry is required");

        Duration remaining = Duration.between(clock.instant(), expiresAt);
        if (remaining.isNegative()) remaining = Duration.ZERO;
        if (remaining.compareTo(maxLifetime) > 0) remaining = maxLifetime;
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(rawValue, remaining).toString());
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

    private void validateRefreshValue(String rawValue) {
        if (!isValidRefreshValue(rawValue)) {
            throw new IllegalArgumentException("refresh value is invalid");
        }
    }

    private boolean isValidRefreshValue(String value) {
        return value != null && !value.isBlank() && value.length() <= MAX_COOKIE_VALUE_LENGTH;
    }
}
