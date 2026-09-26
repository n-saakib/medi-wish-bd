# `ApiErrorController.java`

Source: [`src/main/java/bd/mediwish/web/ApiErrorController.java`](../../../../../../../src/main/java/bd/mediwish/web/ApiErrorController.java)

## Purpose

Package-private Spring Boot `ErrorController` for `/error`. Container and framework errors that no handler turned into a response (unknown routes, unsupported methods or media types, uncaught exceptions) are rendered as the bounded JSON envelope instead of HTML or diagnostic attributes.

## Behavior

`error(request)` reads `RequestDispatcher.ERROR_STATUS_CODE`, keeps it when it is an integer from 400 to 599 and otherwise uses 500. It returns that status with `ApiErrors.body(ApiError.forStatus(status), request)`, so a 404 carries `NOT_FOUND`, an unmapped 4xx such as 415 carries `INVALID_REQUEST`, and any 5xx carries `INTERNAL_ERROR`. The request ID is the one `RequestCorrelationFilter` assigned to the original request.

## Verification

`ApiErrorsTest` simulates `DispatcherType.ERROR` requests for mapped and fallback statuses. `HealthIT` exercises unknown and restricted routes over the real server.
