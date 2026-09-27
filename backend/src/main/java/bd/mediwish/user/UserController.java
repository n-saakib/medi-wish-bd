package bd.mediwish.user;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Returns the signed-in User's current profile, read from the principal the Bearer filter sets. */
@RestController
@RequestMapping("/api/user")
class UserController {
    @GetMapping("/me")
    UserProfile me(@AuthenticationPrincipal(expression = "profile") UserProfile profile) {
        return profile;
    }
}
