# `ApiError.java`

Source: [ApiError.java](../../../../../../../src/main/java/bd/mediwish/web/ApiError.java)

Single owner of bounded public error codes, HTTP statuses and externalized error.<CODE> message keys. Ticket 08 adds STALE_UPDATE and ROLE_CHANGE_REFUSED (both 409). Existing authentication/MFA/validation/rate-limit/error codes retain their statuses.

forStatus maps framework 401/403/404/405/429 explicitly; other 4xx use INVALID_REQUEST, 5xx INTERNAL_ERROR. ApiErrorController keeps the framework status. ApiErrorsTest checks every constant has its English message and the envelope reveals no diagnostics.
