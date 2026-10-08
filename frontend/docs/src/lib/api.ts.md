# `src/lib/api.ts`

Source: [source](<../../../src/lib/api.ts>).

## Purpose and exports

The shared HTTP boundary supports session, user, staff and editable-profile clients. `apiRequest` sends `cache: 'no-store'` and `redirect: 'error'`, bounds the entire operation to 10 seconds and maps transport failures to `REQUEST_FAILED`. `endpoint` resolves paths against the configured API URL, defaulting to `http://127.0.0.1:8080`.

`readJsonResponse` reads at most 16 KiB regardless of Content-Length, cancels larger bodies and rejects malformed JSON. `boundedError` retains only a 1–64 character error code and status. `ApiError.message` is always empty: server messages and diagnostics are never copied to client errors. The module also exports injectable fetch/response/options types and shared record, text and error guards.

## Error copy

`errorMessageKey` selects externalized English copy for authentication, duplicate identifiers, MFA, rate limits and invalid responses. The shared keys are `STALE_UPDATE → staleUpdate`, `ROLE_CHANGE_REFUSED → roleChangeRefused`, `ACCESS_DENIED → accessDenied` and `NOT_FOUND → notFound` (Ticket 08); Ticket 11 adds `ACCOUNT_CLOSING → accountClosing` and `INVALID_REQUEST → checkDetails`. Unknown codes and non-API failures use `genericError`. Registration retains its more specific username-rule message for INVALID_REQUEST.

## Verification

Session and user tests cover body limits, timeouts, failed response reading and bounded errors. [`tests/profile.test.ts`](../../tests/profile.test.ts.md) checks the profile API boundary; mounted profile tests check stale, closing and duplicate-user copy. No credentials, response bodies or personal data are logged.
