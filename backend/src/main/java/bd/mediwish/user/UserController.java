package bd.mediwish.user;

import bd.mediwish.web.ApiErrors;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.http.converter.HttpMessageNotReadableException;

/**
 * Shared User resource endpoints for the reduced authentication slice.
 * Registration remains under {@code /api/auth} because it creates the User's
 * credential boundary; Ticket 03 may split the future login/session endpoints
 * into a dedicated controller once that surface exists.
 */
@RestController
@RequestMapping("/api")
public class UserController {
    private final UserService service;
    private final UserRepository users;
    private final ApiErrors errors;

    public UserController(UserService service, UserRepository users, ApiErrors errors) {
        this.service = service;
        this.users = users;
        this.errors = errors;
    }

    public record Registration(String username, String mobile, String email, String password) {}
    public record Registered(String username, String mobile, String email, boolean mobileVerificationDeferred) {}
    public record Profile(String username, String mobile, String email, boolean mobileVerified) {}

    @PostMapping("/auth/register")
    ResponseEntity<Registered> register(@RequestBody Registration request) {
        if (request == null) throw new UserService.InvalidRegistrationException();
        User user = service.register(request.username(), request.mobile(), request.email(), request.password());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new Registered(user.username(), user.mobile(), user.email(), true));
    }

    @GetMapping("/user/me")
    Profile me(Authentication authentication) {
        User user = users.findByUsername(authentication.getName()).orElseThrow();
        return new Profile(user.username(), user.mobile(), user.email(), user.mobileVerified());
    }

    @ExceptionHandler(UserService.InvalidRegistrationException.class)
    ResponseEntity<ApiErrors.Body> invalid(HttpServletRequest request) {
        return ResponseEntity.badRequest().body(errors.body("INVALID_REQUEST", request));
    }

    @ExceptionHandler(UserService.DuplicateUserException.class)
    ResponseEntity<ApiErrors.Body> duplicate(HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(errors.body("DUPLICATE_USER", request));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiErrors.Body> unreadable(HttpServletRequest request) {
        return ResponseEntity.badRequest().body(errors.body("INVALID_REQUEST", request));
    }
}
