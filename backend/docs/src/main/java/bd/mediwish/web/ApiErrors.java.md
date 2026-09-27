# `ApiErrors.java`

Source: [`src/main/java/bd/mediwish/web/ApiErrors.java`](../../../../../../../src/main/java/bd/mediwish/web/ApiErrors.java)

## Purpose

Package-private component that builds the bounded error envelope for `ApiExceptionHandler`, `ApiErrorController`, the security handlers and the web filters. The envelope is exactly `{ code, message, requestId }`; exception text, URLs, queries, headers, bodies and configuration values are never copied into it.

## Members

| Member | Behavior |
| --- | --- |
| `Body(ApiError code, String message, String requestId)` | The complete public error payload; `code` serializes as the enum name. |
| `body(error, request)` | Resolves the error's `messageKey` from `messages.properties` in `Locale.ENGLISH` and reads the `requestId` request attribute set by `RequestCorrelationFilter`. |
| `write(error, request, response)` | Sets the error's status and `application/json`, then serializes the body **without closing the output stream** (`StreamWriteFeature.AUTO_CLOSE_TARGET` disabled). Closing it would make Tomcat complete the response at once, so a client could receive it before `RequestCorrelationFilter` logs `HTTP response status=` on the way out. Used where no controller is involved: filters and security handlers. |

`ApiErrors` does not set `Cache-Control` or `X-Request-ID`; `RequestCorrelationFilter` writes both on every response before any handler runs.

## Verification

`ApiErrorsTest` checks the exact envelope, that `write` leaves the stream open, and absence of private request data, that every `ApiError` has a message, the status classification and the correlated error page. `HealthIT` verifies the envelope over real HTTP.
