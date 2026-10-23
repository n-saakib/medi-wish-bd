# `ApiError.java`

Source: [ApiError.java](../../../../../../../src/main/java/bd/mediwish/web/ApiError.java)

Single owner of bounded public error codes, HTTP statuses and externalized error.<CODE> message keys. Ticket 08 adds STALE_UPDATE and ROLE_CHANGE_REFUSED, and Ticket 11 adds ACCOUNT_CLOSING (all 409). Existing authentication/MFA/validation/rate-limit/error codes retain their statuses.

Package-private enum that is the single owner of public API error codes, their HTTP statuses and their message keys. Each constant's `messageKey` is `error.<CODE>`, its English message in `messages.properties`.

| Code | Status |
| --- | --- |
| `INVALID_REQUEST` | 400 |
| `AUTHENTICATION_FAILED` | 401 |
| `AUTHENTICATION_REQUIRED` | 401 |
| `MFA_CODE_INVALID` | 400 |
| `ACCESS_DENIED` | 403 |
| `MFA_REQUIRED` | 403 |
| `NOT_FOUND` | 404 |
| `METHOD_NOT_ALLOWED` | 405 |
| `DUPLICATE_USER` | 409 |
| `ACCOUNT_CLOSING` | 409 |
| `MFA_ENROLLMENT_STALE` | 409 |
| `STALE_UPDATE` | 409 |
| `PRICE_REQUIRED` | 409 |
| `CATEGORY_NAME_TAKEN` | 409 |
| `ID_CONFLICT` | 409 |
| `ROLE_CHANGE_REFUSED` | 409 |
| `TOO_MANY_ATTEMPTS` | 429 |
| `INTERNAL_ERROR` | 500 |

## Status classification

`forStatus(status)` classifies a framework error status for `ApiErrorController`: 401, 403, 404, 405 and 429 map to `AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, `NOT_FOUND`, `METHOD_NOT_ALLOWED` and `TOO_MANY_ATTEMPTS`; any other status below 500 (for example 413 or 415) becomes `INVALID_REQUEST`; 500 and above become `INTERNAL_ERROR`. The caller keeps the original HTTP status; only the code and message are chosen here.

`MFA_CODE_INVALID`, `MFA_ENROLLMENT_STALE` and `TOO_MANY_ATTEMPTS` come from `ApiExceptionHandler`; `MFA_REQUIRED` from the access-denied handler in `SecurityConfiguration` for a restricted staff session (Ticket 06). Adding a public error means adding a constant and its message together.

## Verification

`ApiErrorsTest` checks that every constant has an externalized message and covers the status classification, including 429.

Ticket 14 adds 409 STALE_UPDATE (changed stale intent), PRICE_REQUIRED (unpriced activation), CATEGORY_NAME_TAKEN (case-insensitive name collision) and ID_CONFLICT (different payload reusing a create UUID). Each has an externalized message.


Ticket 15 adds bounded externalized IMAGE_INVALID (400), IMAGE_LIMIT_REACHED (409) and STORAGE_UNAVAILABLE (503).
Ticket 16 adds DISCOUNT_ENDED and DISCOUNT_EXCEEDS_PRICE, both 409 with matching externalized messages.
Ticket 12 adds ADDRESS_BOOK_FULL and ADDRESS_CHANGE_LIMIT_REACHED (409), with externalized messages and no change to framework status classification.

Recovery adds CODE_INVALID (400), CURRENT_PASSWORD_INVALID (400) and EMAIL_REQUIRED (409), with externalized messages and the existing bounded envelope.
