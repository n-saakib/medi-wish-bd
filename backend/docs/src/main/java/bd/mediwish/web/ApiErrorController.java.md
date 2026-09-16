# `ApiErrorController.java`

Source: [`src/main/java/bd/mediwish/web/ApiErrorController.java`](../../../../../../../src/main/java/bd/mediwish/web/ApiErrorController.java)

## Purpose and reasoning

`ApiErrorController` adapts Spring Boot's servlet error dispatch to the application's small JSON error contract. It is package-private because it is an internal framework adapter, while `ApiErrors` owns the reusable response mapping and serialization behavior. Centralizing `/error` prevents framework-generated HTML or verbose diagnostics from leaking through unknown routes and failures.

## Class and method

| Member | Behavior and use case |
| --- | --- |
| `ApiErrorController(ApiErrors errors)` | Receives the shared error component through constructor injection. |
| `error(HttpServletRequest request)` | Handles `GET` and other error dispatches at `/error`. It reads `RequestDispatcher.ERROR_STATUS_CODE`, accepts only HTTP error statuses from 400 through 599, falls back to 500 for missing or invalid values, and returns `ApiErrors.body(status, request)`. |
| `ApiErrorController` | Implements Spring Boot's `ErrorController` marker so the framework routes its error dispatch here. |

The method delegates the request ID and English message selection to `ApiErrors`, keeping status fallback and response construction consistent with security failures.

## Verification

`HealthIT` exercises unknown and restricted routes through the HTTP server and checks the bounded envelope. `ApiErrorsTest` verifies the shared body/write behavior used by this controller.
