package bd.mediwish.auth;

import bd.mediwish.user.User;
import bd.mediwish.user.UserService;
import bd.mediwish.web.ApiErrors;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.transaction.TransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP adapter for registration and password-backed session operations.
 * Refresh-token hashing, JWT verification and session transitions remain in
 * the application services behind this controller.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final int MAX_IDENTIFIER_LENGTH = 320;
    private static final int MAX_PASSWORD_LENGTH = 128;

    private final UserService users;
    private final AuthenticationService authentication;
    private final ApiErrors errors;
    private final bd.mediwish.web.RefreshCookieAdapter refreshCookies;

    public AuthController(UserService users, AuthenticationService authentication,
                          ApiErrors errors, bd.mediwish.web.RefreshCookieAdapter refreshCookies) {
        this.users = users;
        this.authentication = authentication;
        this.errors = errors;
        this.refreshCookies = refreshCookies;
    }

    public record Registration(String username, String mobile, String email, String password) {}

    public record Registered(String username, String mobile, String email,
                             boolean mobileVerificationDeferred) {}

    public record LoginRequest(String identifier, String password) {}

    public record SessionResponse(String accessToken, String tokenType, long expiresIn,
                                  AuthenticationService.UserProfile user) {}

    public record CsrfBootstrapResponse(String csrfToken) {}

    @PostMapping("/register")
    public ResponseEntity<Registered> register(@RequestBody Registration request) {
        if (request == null) throw new InvalidRequestException();
        User user = users.register(request.username(), request.mobile(), request.email(), request.password());
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(new Registered(user.username(), user.mobile(), user.email(), true));
    }

    @PostMapping("/login")
    public ResponseEntity<SessionResponse> login(@RequestBody LoginRequest request,
                                                 HttpServletResponse response) {
        requireLoginRequest(request);
        AuthenticationService.AuthenticatedSession session = authentication.signIn(
                request.identifier(), request.password());
        refreshCookies.set(response, session.refreshToken(), session.refreshExpiresAt());
        return sessionResponse(session);
    }

    @GetMapping("/csrf")
    public ResponseEntity<CsrfBootstrapResponse> csrf(CsrfToken token) {
        // Reading the deferred token forces CookieCsrfTokenRepository to emit XSRF-TOKEN.
        // The bounded body also lets a separate frontend origin echo the nonce without
        // reading an API-origin cookie from document.cookie.
        if (token == null || token.getToken() == null || token.getToken().isBlank()) {
            throw new InvalidRequestException();
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new CsrfBootstrapResponse(token.getToken()));
    }

    @PostMapping("/refresh")
    public ResponseEntity<SessionResponse> refresh(HttpServletRequest request,
                                                   HttpServletResponse response) {
        String rawRefresh = refreshCookies.read(request)
                .orElseThrow(AuthenticationRequiredException::new);
        AuthenticationService.AuthenticatedSession session = authentication.refresh(rawRefresh);
        refreshCookies.set(response, session.refreshToken(), session.refreshExpiresAt());
        return sessionResponse(session);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        authentication.logout(refreshCookies.readForLogout(request));
        refreshCookies.clear(response);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private ResponseEntity<SessionResponse> sessionResponse(AuthenticationService.AuthenticatedSession session) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new SessionResponse(session.accessToken(), "Bearer", session.expiresIn(), session.user()));
    }

    private void requireLoginRequest(LoginRequest request) {
        if (request == null || isBlankOrTooLong(request.identifier(), MAX_IDENTIFIER_LENGTH)
                || request.password() == null || request.password().isBlank()
                || request.password().length() > MAX_PASSWORD_LENGTH) {
            throw new InvalidRequestException();
        }
    }

    private boolean isBlankOrTooLong(String value, int maxLength) {
        return value == null || value.isBlank() || value.length() > maxLength;
    }

    @ExceptionHandler(InvalidRequestException.class)
    ResponseEntity<ApiErrors.Body> invalid(HttpServletRequest request) {
        return error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", request);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiErrors.Body> unreadable(HttpServletRequest request) {
        return error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", request);
    }

    @ExceptionHandler(UserService.InvalidRegistrationException.class)
    ResponseEntity<ApiErrors.Body> invalidRegistration(HttpServletRequest request) {
        return error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", request);
    }

    @ExceptionHandler(UserService.DuplicateUserException.class)
    ResponseEntity<ApiErrors.Body> duplicate(HttpServletRequest request) {
        return error(HttpStatus.CONFLICT, "DUPLICATE_USER", request);
    }

    @ExceptionHandler(AuthenticationFailedException.class)
    ResponseEntity<ApiErrors.Body> authenticationFailed(HttpServletRequest request) {
        return error(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_FAILED", request);
    }

    @ExceptionHandler(AuthenticationRequiredException.class)
    ResponseEntity<ApiErrors.Body> authenticationRequired(HttpServletRequest request) {
        return error(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", request);
    }

    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    ResponseEntity<ApiErrors.Body> persistenceFailure(HttpServletRequest request) {
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", request);
    }

    private ResponseEntity<ApiErrors.Body> error(HttpStatus status, String code, HttpServletRequest request) {
        return ResponseEntity.status(status)
                .cacheControl(CacheControl.noStore())
                .body(errors.body(code, request));
    }

    /** Marker exception used only for bounded request-shape failures. */
    static final class InvalidRequestException extends RuntimeException {}
}
