package bd.mediwish.user;

/** The User fields returned to that User after sign-in, refresh and from {@code /api/user/me}. */
public record UserProfile(String username, String mobile, String email, boolean mobileVerified) {
    public static UserProfile from(User user) {
        return new UserProfile(user.username(), user.mobile(), user.email(), user.mobileVerified());
    }
}
