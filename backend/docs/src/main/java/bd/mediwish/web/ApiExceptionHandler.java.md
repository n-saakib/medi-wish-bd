# `ApiExceptionHandler.java`

Source: [`src/main/java/bd/mediwish/web/ApiExceptionHandler.java`](../../../../../../../src/main/java/bd/mediwish/web/ApiExceptionHandler.java)

## Purpose

Package-private `@RestControllerAdvice` that maps the domain exceptions of every controller to the bounded error envelope. Controllers throw; they do not build error responses.

| Exception | Response |
| --- | --- |
| `InvalidRequestException`, `UserService.InvalidRegistrationException`, `HttpMessageNotReadableException` | `400 INVALID_REQUEST` |
| `UserService.DuplicateUserException` | `409 DUPLICATE_USER` |
| `AuthenticationFailedException` | `401 AUTHENTICATION_FAILED` |
| `AuthenticationRequiredException` (including `SessionReplayException`) | `401 AUTHENTICATION_REQUIRED` |
| `DataAccessException`, `TransactionException` | `500 INTERNAL_ERROR` |

## Boundaries

- Handling unreadable JSON and persistence failures here keeps their messages, which can echo request bodies or row values, out of both the response and the log; the handler logs nothing.
- Exceptions not listed propagate to the container and reach `ApiErrorController` as a bounded `500`.
- Filter-level failures (CORS, body limit, bearer, security entry point) never reach this advice; they use `ApiErrors.write` directly.

## Verification

`ApiExceptionHandlerTest` maps each listed failure to its status and code and proves unreadable JSON is `400` without echoing the body. The auth integration tests cover these errors over real HTTP and PostgreSQL, including captured-log privacy.
