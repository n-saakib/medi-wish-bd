package bd.mediwish.auth;

/** Why a session was revoked; the code is what {@code user_sessions.revoked_reason} stores. */
enum RevocationReason {
    LOGOUT("logout"),
    REFRESH_REPLAY("refresh-replay"),
    USER_UNAVAILABLE("user-unavailable"),
    MFA_VERIFIED("mfa-verified"),
    STAFF_PROVISIONED("staff-provisioned");

    final String code;

    RevocationReason(String code) {
        this.code = code;
    }
}
