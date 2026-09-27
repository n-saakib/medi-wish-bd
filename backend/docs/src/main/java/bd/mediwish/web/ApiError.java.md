# `ApiError.java`

Source: [`src/main/java/bd/mediwish/web/ApiError.java`](../../../../../../../src/main/java/bd/mediwish/web/ApiError.java)

## Purpose

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
| `MFA_ENROLLMENT_STALE` | 409 |
| `TOO_MANY_ATTEMPTS` | 429 |
| `INTERNAL_ERROR` | 500 |

## Status classification

`forStatus(status)` classifies a framework error status for `ApiErrorController`: 401, 403, 404, 405 and 429 map to `AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, `NOT_FOUND`, `METHOD_NOT_ALLOWED` and `TOO_MANY_ATTEMPTS`; any other status below 500 (for example 413 or 415) becomes `INVALID_REQUEST`; 500 and above become `INTERNAL_ERROR`. The caller keeps the original HTTP status; only the code and message are chosen here.

`MFA_CODE_INVALID`, `MFA_ENROLLMENT_STALE` and `TOO_MANY_ATTEMPTS` come from `ApiExceptionHandler`; `MFA_REQUIRED` from the access-denied handler in `SecurityConfiguration` for a restricted staff session (Ticket 06). Adding a public error means adding a constant and its message together.

## Verification

`ApiErrorsTest` checks that every constant has an externalized message and covers the status classification, including 429.
