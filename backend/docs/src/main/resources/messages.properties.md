# `messages.properties`

Source: [messages.properties](../../../../src/main/resources/messages.properties)

Externalized English text for every ApiError, resolved as error.<CODE>. Ticket 08 adds the shared STALE_UPDATE instruction to reload and ROLE_CHANGE_REFUSED message, both matching the frozen contract. Existing messages stay unchanged.

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
| `error.MFA_REQUIRED` | A staff session must enroll or verify its authenticator before the route applies (`403`). |
| `error.MFA_CODE_INVALID` | The authenticator code is wrong or already used (`400`). |
| `error.MFA_ENROLLMENT_STALE` | The enrollment expired or was replaced; the client starts again (`409`). |
| `error.TOO_MANY_ATTEMPTS` | MFA verification is locked after too many wrong codes (`429`). |
| `error.STALE_UPDATE` | The record changed after the caller loaded it; reload and try again (`409`). Shared by Tickets 08, 11 and 14. |
| `error.ROLE_CHANGE_REFUSED` | The requested role change is not allowed (`409`). |
| `error.ACCOUNT_CLOSING` | A closing account cannot change its profile or pending mobile (`409`). |

There is exactly one key per `ApiError` constant; add both together. Do not put exception text, SQL details, credentials, OTPs, medicine searches or order contents in these messages.

## Verification

`ApiErrorsTest` checks that every `ApiError` constant has a message and the exact English envelope. HTTP integration tests verify that only these safe messages appear in error responses.

Ticket 14 adds the exact messages: PRICE_REQUIRED = Add a price before activating this product.; CATEGORY_NAME_TAKEN = A category with this name already exists.; ID_CONFLICT = This id is already used by a different record. It reuses the shared STALE_UPDATE message. No submitted field or database exception data is included.

## Ticket 11 messages

error.STALE_UPDATE (409) asks the caller to reload after a changed profile version. error.ACCOUNT_CLOSING (409) explains why a closing account cannot mutate its profile or pending mobile. Neither identifies a conflicting user or echoes private values.

Ticket 16: error.DISCOUNT_ENDED = This discount has ended and can no longer be changed.; error.DISCOUNT_EXCEEDS_PRICE = The discount must be smaller than the product's selling price.
