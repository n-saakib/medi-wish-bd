# `tests/user.test.ts`

Source: [`tests/user.test.ts`](../../tests/user.test.ts)

## Purpose

Unit coverage for the User API calls in [`src/lib/user.ts`](../src/lib/user.ts.md) and, through them, the error and timeout handling of [`src/lib/api.ts`](../src/lib/api.ts.md). It uses the [`fakeApi`](fakeApi.ts.md) routes and needs no live service.

## Verification

- **Registration:** the JSON `POST` to `/api/auth/register` on the configured base URL; a `201` with an empty, JSON or non-JSON body resolves with nothing; a `200` is rejected; an error keeps only `code` and `status` (the API's message, request ID and other fields are dropped); an overlong code becomes `REQUEST_FAILED`; an unreadable error body is a request failure; an oversized error body with a missing or understated `Content-Length` is cancelled; a transport failure hides its detail; a registration the API never answers is still pending at 9 999 ms and fails at 10 seconds.
- **Profile:** `loadUserProfile` sends `GET /api/user/me` to the session client's origin with its Bearer token and returns only the documented fields; a malformed profile or malformed JSON is `INVALID_RESPONSE`; a `403` keeps only its code and status; a body still arriving after 10 seconds fails with `REQUEST_FAILED`.

On 2026-09-26 this suite passed as part of `npm run test:unit`.
