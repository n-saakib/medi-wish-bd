package bd.mediwish.auth;

/** MFA verification is locked after too many wrong codes (D3). */
public class TooManyAttemptsException extends RuntimeException {}
