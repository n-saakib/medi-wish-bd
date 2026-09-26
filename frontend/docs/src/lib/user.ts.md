# `src/lib/user.ts`

Source: [`src/lib/user.ts`](../../../src/lib/user.ts)

## Purpose

The User API calls: public registration and the signed-in user's profile. Both run through the shared [`api.ts`](api.ts.md) boundary, so they have the 10-second operation timeout and fail with a bounded `ApiError`.

## Exports

- `registerUser(input, { baseUrl?, fetch? })` posts `{ username, mobile, email?, password }` as JSON to `POST /api/auth/register` and resolves with nothing on `201`, whatever the body. Any other status rejects with the response's bounded error code.
- `loadUserProfile(session)` calls `GET /api/user/me` through the session's `authenticatedFetch`, so the request carries the Bearer token, stays on the session's API origin and gets the single refresh-and-retry. It resolves with the projected `SessionUser`; an error status rejects with its bounded code, and a malformed profile with `INVALID_RESPONSE`.
- `RegistrationInput` — the registration payload type.

## Use cases and boundaries

[`RegistrationForm`](../auth/RegistrationForm.tsx.md) calls `registerUser`, then signs in. [`AccountSummary`](../account/AccountSummary.tsx.md) calls `loadUserProfile` with the provider's `authenticatedFetch`, so a final `401` also ends the session in the UI. Sign-in, refresh and logout belong to [`session.ts`](session.ts.md). OTP, MFA, recovery and OAuth are outside this module.

## Verification

[`tests/user.test.ts`](../../tests/user.test.ts.md) covers the registration request, any `201` body, non-`201` statuses, bounded and overlong error codes, unreadable and oversized error bodies, transport failures and the timeout, plus the profile request's origin and Bearer header, field projection, malformed profiles, error codes and body deadline.
