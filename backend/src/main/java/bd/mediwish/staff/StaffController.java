package bd.mediwish.staff;

import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.auth.StaffAccessPolicy;
import bd.mediwish.auth.StaffBootstrapRepository;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** The staff route that only an MFA-verified Admin or Moderator session reaches (Ticket 06). */
@RestController
@RequestMapping("/api/staff")
class StaffController {
    private final StaffBootstrapRepository bootstrap;

    StaffController(StaffBootstrapRepository bootstrap) {
        this.bootstrap = bootstrap;
    }

    record StaffAccess(String username, List<String> roles, boolean superAdmin) {}

    @GetMapping("/me")
    StaffAccess me(@AuthenticationPrincipal CurrentUserAuthentication.CurrentUser current) {
        List<String> roles = current.roles().stream().map(Enum::name).sorted().toList();
        boolean superAdmin = StaffAccessPolicy.isSuperAdmin(current.userId(), current.roles(),
                bootstrap.superAdminUserId().orElse(null));
        return new StaffAccess(current.profile().username(), roles, superAdmin);
    }
}
