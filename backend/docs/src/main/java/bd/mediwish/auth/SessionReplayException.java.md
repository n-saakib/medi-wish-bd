# `SessionReplayException.java`

Source: [`src/main/java/bd/mediwish/auth/SessionReplayException.java`](../../../../../../../src/main/java/bd/mediwish/auth/SessionReplayException.java)

Package-private `AuthenticationRequiredException` subtype thrown by `SessionService.rotate` when a consumed refresh generation is presented again. `rotate` first revokes the family with `RevocationReason.REFRESH_REPLAY` and declares `noRollbackFor` this exception, so the revocation commits while the caller receives the generic `401 AUTHENTICATION_REQUIRED`. Covered by `SessionServiceTest`, `SessionIT` and `ConcurrentSessionIT`.
