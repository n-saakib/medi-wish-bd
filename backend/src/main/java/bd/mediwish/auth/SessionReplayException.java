package bd.mediwish.auth;

/** A consumed refresh value was presented again; its session is revoked and the revocation is kept. */
class SessionReplayException extends AuthenticationRequiredException {}
