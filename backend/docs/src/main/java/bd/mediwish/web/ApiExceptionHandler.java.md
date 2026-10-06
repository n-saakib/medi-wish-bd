# `ApiExceptionHandler.java`

Source: [ApiExceptionHandler.java](../../../../../../../src/main/java/bd/mediwish/web/ApiExceptionHandler.java)

Maps controller/domain failures to the correlated bounded envelope without logging exception text. Validation, registration shape and unreadable JSON are INVALID_REQUEST; duplicate identities conflict; authentication, MFA and throttle failures retain existing codes. Persistence/transaction failures become INTERNAL_ERROR.

Ticket 08 maps StaleUpdateException to 409 STALE_UPDATE, RoleChangeRefusedException to 409 ROLE_CHANGE_REFUSED and UserNotFoundException to 404 NOT_FOUND. Unsupported media on administrative User routes is 400 INVALID_REQUEST as frozen for those commands; existing credential routes retain 415 INVALID_REQUEST. Security AccessDeniedException still reaches the security denial handler. Filter failures use ApiErrors directly.

ApiExceptionHandlerTest and real API tests verify statuses, correlation and privacy.
