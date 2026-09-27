package bd.mediwish.auth;

/** The enrollment named is not the User's current, unexpired pending authenticator. */
public class MfaEnrollmentStaleException extends RuntimeException {}
