# `messages.properties`

Source: [`src/main/resources/messages.properties`](../../../../src/main/resources/messages.properties)

## Purpose and reasoning

This Java message bundle contains the public English text for the bounded error codes produced by `ApiErrors`. Keeping text outside Java makes responses consistent and gives future localization or copy changes one small resource boundary without changing status mapping code.

## Messages

| Key | Client-facing meaning and use case |
| --- | --- |
| `error.INVALID_REQUEST` | The request cannot be accepted (`400`). |
| `error.AUTHENTICATION_REQUIRED` | The request needs authentication (`401`). |
| `error.ACCESS_DENIED` | The caller is not allowed to perform the request (`403`). |
| `error.NOT_FOUND` | The requested resource is absent (`404`). |
| `error.METHOD_NOT_ALLOWED` | The route exists but does not allow the HTTP method (`405`). |
| `error.INTERNAL_ERROR` | A generic safe message for all other error statuses. |

Keys are deliberately aligned with the codes in `ApiErrors.body`. Do not put exception text, SQL details, credentials, OTPs, medicine searches or order contents in these messages.

## Verification

`ApiErrorsTest` checks English lookup for authentication and access-denied responses and the generic fallback. HTTP integration tests verify that only these safe messages appear in error responses.
