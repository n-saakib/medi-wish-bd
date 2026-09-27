# `src/lib/api.ts`

Source: [`src/lib/api.ts`](../../../src/lib/api.ts)

## Purpose

The shared HTTP boundary for the API clients in [`session.ts`](session.ts.md) and [`user.ts`](user.ts.md). It owns the API base URL, the request defaults, the operation timeout, bounded JSON reading and the one error type, so neither client repeats them.

## Exports

- `ApiError` — a bounded failure: `code` (the API's error code, or a client code) and `status` (`0` when no response arrived). Its `message` is always empty, because the API's `message` text is never read or shown.
- `ApiClientOptions` — `{ baseUrl?, fetch? }`, the options both clients accept; tests inject `fetch`.
- `errorMessageKey(reason)` — the `ErrorMessageKey` in [`messages/en.json`](../../messages/en.json.md) for a failure: `authenticationFailed`, `duplicateUser`, `mfaRequired` (`MFA_REQUIRED`), `mfaCodeInvalid` (`MFA_CODE_INVALID`), `mfaEnrollmentStale` (`MFA_ENROLLMENT_STALE`), `tooManyAttempts` (`TOO_MANY_ATTEMPTS`), `invalidResponse`, or `genericError` for every other code and for non-`ApiError` failures.
- `apiRequest(fetcher, url, init, readResponse)` — sends one request with `cache: 'no-store'` and `redirect: 'error'`, and aborts it after 10 seconds, including the time `readResponse` spends reading the body. A transport failure or abort becomes `REQUEST_FAILED` with status `0`.
- `endpoint(path, baseUrl?)` — resolves a path against `NEXT_PUBLIC_MEDI_WISH_API_URL`, defaulting to `http://127.0.0.1:8080`.
- `readJsonResponse(response)` — reads at most 16 KiB of JSON whatever `Content-Length` claims, cancelling a larger body. Malformed or oversized JSON is `INVALID_RESPONSE`; a body-read failure is `REQUEST_FAILED`.
- `boundedError(response)` — the `ApiError` for a failed response. It keeps the body's `code` only when it is a string of 1–64 characters, and otherwise uses `REQUEST_FAILED`.
- `isRecord`, `boundedText`, `requestFailure` and `invalidResponse` — the small guards and error constructors the clients share. The `ApiFetch` and `ResponseReader` types describe the injectable `fetch` and a response reader.

## Use cases and boundaries

Client code calls `apiRequest` rather than `fetch`, so every API call gets the same timeout, caching and error shape. Components pick copy with `errorMessageKey`; a code the UI does not distinguish falls back to the generic message rather than to server text. No credential, token or response body is logged or copied into an error.

## Verification

Covered through its callers: [`tests/session.test.ts`](../../tests/session.test.ts.md) covers the 16 KiB limit and the sign-in, refresh and logout timeouts, and [`tests/user.test.ts`](../../tests/user.test.ts.md) covers bounded error codes, oversized and unreadable error bodies, transport failures and the registration and profile timeouts. The form and MFA page tests check the `errorMessageKey` copy.
