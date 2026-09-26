package bd.mediwish.auth;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/** Reads, sets and clears the HttpOnly refresh cookie so no cookie policy reaches the session services. */
@Component
class RefreshCookieAdapter {
    private static final String COOKIE_NAME = "MW_REFRESH";
    static final int MAX_VALUE_LENGTH = 4096;

    private final boolean secure;
    private final Clock clock;

    RefreshCookieAdapter(AuthProperties properties, Clock clock) {
        this.secure = properties.cookie().secure();
        this.clock = clock;
    }

    /** Empty when no refresh cookie was sent; a blank, oversized or duplicated cookie is rejected. */
    Optional<String> read(HttpServletRequest request) {
        List<String> values = values(request);
        if (values.isEmpty()) return Optional.empty();
        if (values.size() > 1 || !isUsable(values.getFirst())) throw new AuthenticationRequiredException();
        return Optional.of(values.getFirst());
    }

    /** Every distinct usable value, so logout can revoke each session a duplicated cookie represents. */
    List<String> readAll(HttpServletRequest request) {
        return values(request).stream().filter(RefreshCookieAdapter::isUsable).distinct().toList();
    }

    void set(HttpServletResponse response, String value, Instant expiresAt) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(value, Duration.between(clock.instant(), expiresAt)));
    }

    void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO));
    }

    private static List<String> values(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return List.of();
        return Arrays.stream(cookies).filter(cookie -> COOKIE_NAME.equals(cookie.getName()))
                .map(Cookie::getValue).toList();
    }

    private static boolean isUsable(String value) {
        return !value.isBlank() && value.length() <= MAX_VALUE_LENGTH;
    }

    private String cookie(String value, Duration maxAge) {
        return ResponseCookie.from(COOKIE_NAME, value)
                .httpOnly(true)
                .secure(secure)
                .sameSite("Lax")
                .path("/api/auth")
                .maxAge(maxAge)
                .build()
                .toString();
    }
}
