package bd.mediwish.auth;

/** Why a session was revoked; the code is what {@code user_sessions.revoked_reason} stores. */
enum RevocationReason {
    LOGOUT("logout"),
    REFRESH_REPLAY("refresh-replay"),
    USER_UNAVAILABLE("user-unavailable"),
    MFA_VERIFIED("mfa-verified"),
    MFA_REPLACEMENT_STARTED("mfa-replacement-started"),
    MFA_REPLACED("mfa-replaced"),
    STAFF_PROVISIONED("staff-provisioned"),
    ROLE_CHANGED("role-changed"),
    PASSWORD_RESET("password-reset"),
    EMAIL_CHANGED("email-changed");

    final String code;

    RevocationReason(String code) {
        this.code = code;
    }
}
