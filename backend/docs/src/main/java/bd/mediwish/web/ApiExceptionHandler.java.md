# `ApiExceptionHandler.java`

Source: [ApiExceptionHandler.java](../../../../../../../src/main/java/bd/mediwish/web/ApiExceptionHandler.java)

Maps controller/domain failures to the correlated bounded envelope without logging exception text. Validation, registration shape and unreadable JSON are INVALID_REQUEST; duplicate identities conflict; authentication, MFA and throttle failures retain existing codes. Persistence/transaction failures become INTERNAL_ERROR.

Ticket 08 maps StaleUpdateException to 409 STALE_UPDATE, RoleChangeRefusedException to 409 ROLE_CHANGE_REFUSED and UserNotFoundException to 404 NOT_FOUND. Unsupported media on administrative User routes is 400 INVALID_REQUEST as frozen for those commands; existing credential routes retain 415 INVALID_REQUEST. Security AccessDeniedException still reaches the security denial handler. Filter failures use ApiErrors directly.

| Exception | Response |
| --- | --- |
| `InvalidRequestException`, `UserService.InvalidRegistrationException`, `HttpMessageNotReadableException`, `InvalidProfileException` | `400 INVALID_REQUEST` |
| `StaleUpdateException` (shared, `bd.mediwish.web`) | `409 STALE_UPDATE` |
| `RoleChangeRefusedException` | `409 ROLE_CHANGE_REFUSED` |
| `UserNotFoundException` | `404 NOT_FOUND` |
| `HttpMediaTypeNotSupportedException` | `400 INVALID_REQUEST` on `/api/admin/users/**`, otherwise `415 INVALID_REQUEST` |
| `AccountClosingException` | `409 ACCOUNT_CLOSING` |
| `UserService.DuplicateUserException` | `409 DUPLICATE_USER` |
| `AuthenticationFailedException` | `401 AUTHENTICATION_FAILED` |
| `AuthenticationRequiredException` (including `SessionReplayException`) | `401 AUTHENTICATION_REQUIRED` |
| `MfaCodeInvalidException` | `400 MFA_CODE_INVALID` |
| `MfaEnrollmentStaleException` | `409 MFA_ENROLLMENT_STALE` |
| `TooManyAttemptsException` | `429 TOO_MANY_ATTEMPTS` |
| `DataAccessException`, `TransactionException` | `500 INTERNAL_ERROR` |

## Boundaries

- Handling unreadable JSON and persistence failures here keeps their messages, which can echo request bodies or row values, out of both the response and the log; the handler logs nothing.
- `AccessDeniedException` thrown by `StaffMfaService` (lost staff role, no active factor) is not handled here; Spring Security's exception translation answers it with the access-denied handler (`403`).
- Exceptions not listed propagate to the container and reach `ApiErrorController` as a bounded `500`.
- Filter-level failures (CORS, body limit, bearer, security entry point) never reach this advice; they use `ApiErrors.write` directly.

## Verification

`ApiExceptionHandlerTest` maps each listed failure, including the three MFA failures and Ticket 08's role and not-found failures, to its status and code and proves unreadable JSON is `400` without echoing the body. The auth integration tests cover these errors over real HTTP and PostgreSQL, including captured-log privacy.
