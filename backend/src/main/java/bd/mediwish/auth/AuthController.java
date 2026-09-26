package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

/**
 * HTTP adapter for registration and password-backed session operations.
 * Refresh-token hashing, JWT verification and session transitions remain in
 * the application services behind this controller.
 */
@RestController
@RequestMapping("/api/auth")
class AuthController {
    private static final int MAX_IDENTIFIER_LENGTH = 320;

    private final UserService users;
    private final AuthenticationService authentication;
    private final RefreshCookieAdapter refreshCookies;

    AuthController(UserService users, AuthenticationService authentication, RefreshCookieAdapter refreshCookies) {
        this.users = users;
        this.authentication = authentication;
        this.refreshCookies = refreshCookies;
    }

    record Registration(String username, String mobile, String email, String password) {}

    record Registered(String username, String mobile, String email, boolean mobileVerificationDeferred) {}

    record LoginRequest(String identifier, String password) {}

    record SessionResponse(String accessToken, String tokenType, long expiresIn, UserProfile user) {}

    record CsrfBootstrapResponse(String csrfToken) {}

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    Registered register(@RequestBody Registration request) {
        User user = users.register(request.username(), request.mobile(), request.email(), request.password());
        return new Registered(user.username(), user.mobile(), user.email(), true);
    }

    @PostMapping("/login")
    SessionResponse login(@RequestBody LoginRequest request, HttpServletResponse response) {
        if (isBlankOrLongerThan(request.identifier(), MAX_IDENTIFIER_LENGTH)
                || isBlankOrLongerThan(request.password(), UserService.MAX_PASSWORD_LENGTH)) {
            throw new InvalidRequestException();
        }
        return issue(authentication.signIn(request.identifier(), request.password()), response);
    }

    @GetMapping("/csrf")
    CsrfBootstrapResponse csrf(CsrfToken token) {
        // Reading the deferred token forces CookieCsrfTokenRepository to emit XSRF-TOKEN.
        // The body lets a separate frontend origin echo the nonce without reading an API-origin cookie.
        return new CsrfBootstrapResponse(token.getToken());
    }

    /** No refresh cookie means signed out (204); a rejected cookie is cleared with the 401. */
    @PostMapping("/refresh")
    ResponseEntity<SessionResponse> refresh(HttpServletRequest request, HttpServletResponse response) {
        try {
            Optional<String> presented = refreshCookies.read(request);
            if (presented.isEmpty()) return ResponseEntity.noContent().build();
            return ResponseEntity.ok(issue(authentication.refresh(presented.get()), response));
        } catch (AuthenticationRequiredException exception) {
            refreshCookies.clear(response);
            throw exception;
        }
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(HttpServletRequest request, HttpServletResponse response) {
        authentication.logout(refreshCookies.readAll(request));
        refreshCookies.clear(response);
    }

    private SessionResponse issue(AuthenticationService.AuthenticatedSession session, HttpServletResponse response) {
        refreshCookies.set(response, session.refreshToken(), session.refreshExpiresAt());
        return new SessionResponse(session.accessToken(), "Bearer", session.expiresIn(), session.user());
    }

    private static boolean isBlankOrLongerThan(String value, int maxLength) {
        return value == null || value.isBlank() || value.length() > maxLength;
    }
}
