package bd.mediwish.user;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.web.ApiErrors;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Exposes the authenticated user's safe, current profile projection. */
@RestController
@RequestMapping("/api")
public class UserController {
    private final ApiErrors errors;

    public UserController(ApiErrors errors) {
        this.errors = errors;
    }

    public record Profile(String username, String mobile, String email, boolean mobileVerified) {}

    @GetMapping("/user/me")
    Profile me(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal()
                instanceof CurrentUserAuthentication.CurrentUser current)) {
            throw new AuthenticationRequiredException();
        }
        return new Profile(current.username(), current.mobile(), current.email(), current.mobileVerified());
    }

    @ExceptionHandler(AuthenticationRequiredException.class)
    ResponseEntity<ApiErrors.Body> authenticationRequired(HttpServletRequest request) {
        return ResponseEntity.status(401).cacheControl(CacheControl.noStore())
                .body(errors.body("AUTHENTICATION_REQUIRED", request));
    }
}
