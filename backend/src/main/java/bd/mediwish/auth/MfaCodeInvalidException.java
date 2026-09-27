package bd.mediwish.auth;

/** A well-formed authenticator code that is wrong or already used; a malformed one is an invalid request. */
public class MfaCodeInvalidException extends RuntimeException {}
