package bd.mediwish.user;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Returns the signed-in User's current profile, which the Bearer filter sets as the principal. */
@RestController
@RequestMapping("/api/user")
class UserController {
    @GetMapping("/me")
    UserProfile me(@AuthenticationPrincipal UserProfile profile) {
        return profile;
    }
}
