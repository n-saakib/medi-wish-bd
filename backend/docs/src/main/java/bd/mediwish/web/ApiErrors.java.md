# `ApiErrors.java`

Source: [`src/main/java/bd/mediwish/web/ApiErrors.java`](../../../../../../../src/main/java/bd/mediwish/web/ApiErrors.java)

## Purpose and reasoning

`ApiErrors` is the single formatter for public HTTP failures. It deliberately exposes only a stable code, an English message and the current request ID. The implementation never copies exception text, URLs, query strings, request bodies or configuration values into the response. That gives clients a predictable contract while keeping internal details private.

## Class, record and methods

| Member | Behavior and use case |
| --- | --- |
| `ApiErrors(MessageSource messages, ObjectMapper json)` | Constructor-injects the message bundle and Jackson mapper used by both the error controller and security handlers. |
| `Body(String code, String message, String requestId)` | Immutable public error payload. The three fields are intentionally the complete response shape. |
| `body(int status, HttpServletRequest request)` | Maps 400, 401, 403, 404 and 405 to stable codes; every other status becomes `INTERNAL_ERROR`. It resolves `error.<code>` from `messages.properties` in `Locale.ENGLISH` and reads the request-scoped `requestId`. |
| `body(String code, HttpServletRequest request)` | Resolves a deliberately selected application error code through the same English message bundle and request-correlation field without accepting exception or request data. Controllers use it for bounded domain errors. |
| `write(int status, HttpServletRequest request, HttpServletResponse response)` | Writes the same body as JSON, sets the HTTP status and `Cache-Control: no-store`, then serializes with the injected mapper. It is used by authentication and authorization handlers, where a controller is not involved. |

The status mapping is intentionally small. New public error semantics should add a deliberate code and message rather than exposing framework text.

## Verification

`ApiErrorsTest` checks the exact 401 contract, no-store behavior, fallback mapping and the absence of private request data. `HealthIT` verifies the contract over real HTTP for restricted and unknown routes.
