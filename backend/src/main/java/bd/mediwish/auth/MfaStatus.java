package bd.mediwish.auth;

/** How far a session satisfies staff MFA; returned as {@code mfa} on every session response. */
public enum MfaStatus {
    NOT_REQUIRED,
    ENROLLMENT_REQUIRED,
    VERIFICATION_REQUIRED,
    REPLACEMENT_REQUIRED,
    VERIFIED
}
