# `messages.properties`

Source: [`src/main/resources/messages.properties`](../../../../src/main/resources/messages.properties)

## Purpose and reasoning

This Java message bundle contains the public English text for each `ApiError` code; `ApiErrors` resolves `error.<CODE>` in English. Keeping text outside Java makes responses consistent and gives future localization or copy changes one small resource boundary without changing status mapping code.

## Messages

| Key | Client-facing meaning and use case |
| --- | --- |
| `error.INVALID_REQUEST` | The request cannot be accepted (`400`); also the code for other unmapped 4xx framework statuses such as `413` and `415`. |
| `error.AUTHENTICATION_REQUIRED` | The request needs authentication (`401`). |
| `error.AUTHENTICATION_FAILED` | The supplied identifier/password pair cannot be authenticated (`401`); it intentionally does not reveal which credential failed. |
| `error.ACCESS_DENIED` | The caller is not allowed to perform the request (`403`). |
| `error.NOT_FOUND` | The requested resource is absent (`404`). |
| `error.METHOD_NOT_ALLOWED` | The route exists but does not allow the HTTP method (`405`). |
| `error.INTERNAL_ERROR` | A generic safe message for `5xx` failures (`500` for persistence and transaction errors). |
| `error.DUPLICATE_USER` | The username, mobile number or email is already in use (`409`). |

There is exactly one key per `ApiError` constant; add both together. Do not put exception text, SQL details, credentials, OTPs, medicine searches or order contents in these messages.

## Verification

`ApiErrorsTest` checks that every `ApiError` constant has a message and the exact English envelope. HTTP integration tests verify that only these safe messages appear in error responses.
