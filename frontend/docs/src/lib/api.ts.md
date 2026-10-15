# `src/lib/api.ts`

Source: [source](<../../../src/lib/api.ts>).

## Purpose and exports

The shared HTTP boundary supports session, user, staff, Admin user, editable-profile and catalog clients. `apiRequest` sends `cache: 'no-store'` and `redirect: 'error'`, bounds the entire operation to 10 seconds and maps transport failures to `REQUEST_FAILED`. `endpoint` resolves paths against the configured API URL, defaulting to `http://127.0.0.1:8080`.

`readJsonResponse` reads at most 16 KiB regardless of Content-Length, cancels larger bodies and rejects malformed JSON. `boundedError` retains only a 1–64 character error code and status. `ApiError.message` is always empty: server messages and diagnostics are never copied to client errors. The module also exports injectable fetch/response/options types and shared record, text and error guards.

`readJsonResponse(response, maxBytes?)` accepts a larger bound for one caller: catalog success responses use 256 KiB for valid 50-item pages, while error bodies keep 16 KiB.

## Error copy

`errorMessageKey` selects externalized English copy for authentication, duplicate identifiers, MFA, rate limits and invalid responses. The shared keys are `STALE_UPDATE → staleUpdate`, `ROLE_CHANGE_REFUSED → roleChangeRefused`, `ACCESS_DENIED → accessDenied` and `NOT_FOUND → notFound` (Ticket 08); Ticket 11 adds `ACCOUNT_CLOSING → accountClosing` and `INVALID_REQUEST → checkDetails`; Ticket 14 adds `PRICE_REQUIRED → priceRequired` and `CATEGORY_NAME_TAKEN → categoryNameTaken`. Unknown codes and non-API failures use `genericError`. Registration uses the same `checkDetails` copy for INVALID_REQUEST and names refused fields itself before sending.

## Verification

Session and user tests cover body limits, timeouts, failed response reading and bounded errors. [`tests/profile.test.ts`](../../tests/profile.test.ts.md) checks the profile API boundary; mounted profile tests check stale, closing and duplicate-user copy. No credentials, response bodies or personal data are logged.
[`tests/catalog.test.ts`](../../tests/catalog.test.ts.md) covers the catalog bound without widening the default.

Ticket 15 maps IMAGE_INVALID to imageInvalid, IMAGE_LIMIT_REACHED to imageLimitReached and STORAGE_UNAVAILABLE to storageUnavailable. The existing bounded error object, response limits and operation timeout remain shared.

## Ticket 16

Ticket 16 maps DISCOUNT_ENDED and DISCOUNT_EXCEEDS_PRICE to externalized bounded error copy.
