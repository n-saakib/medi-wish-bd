# `ApiError.java`

Source: [`src/main/java/bd/mediwish/web/ApiError.java`](../../../../../../../src/main/java/bd/mediwish/web/ApiError.java)

## Purpose

Package-private enum that is the single owner of public API error codes, their HTTP statuses and their message keys. Each constant's `messageKey` is `error.<CODE>`, its English message in `messages.properties`.

| Code | Status |
| --- | --- |
| `INVALID_REQUEST` | 400 |
| `AUTHENTICATION_FAILED` | 401 |
| `AUTHENTICATION_REQUIRED` | 401 |
| `ACCESS_DENIED` | 403 |
| `NOT_FOUND` | 404 |
| `METHOD_NOT_ALLOWED` | 405 |
| `DUPLICATE_USER` | 409 |
| `INTERNAL_ERROR` | 500 |

## Status classification

`forStatus(status)` classifies a framework error status for `ApiErrorController`: 401, 403, 404 and 405 map to their codes; any other status below 500 (for example 413 or 415) becomes `INVALID_REQUEST`; 500 and above become `INTERNAL_ERROR`. The caller keeps the original HTTP status; only the code and message are chosen here.

Adding a public error means adding a constant and its message together.

## Verification

`ApiErrorsTest` checks that every constant has an externalized message and covers the status classification.
