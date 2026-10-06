package bd.mediwish.user;

import java.time.LocalDate;

/** The complete owner-only profile response, excluding credentials and roles. */
public record ProfileView(String username, String fullName, String mobile, boolean mobileVerified,
                          String pendingMobile, String email, LocalDate dateOfBirth,
                          AccountState accountState, long version) {
    public static ProfileView from(User user, MobileChange pending) {
        return new ProfileView(user.username(), user.fullName(), user.mobile(), user.mobileVerified(),
                pending == null ? null : pending.newMobile(), user.email(), user.dateOfBirth(),
                user.accountState(), user.profileVersion());
    }
}
