# `tests/MfaChallenge.test.ts`

Source: [`tests/MfaChallenge.test.ts`](../../tests/MfaChallenge.test.ts)

## Purpose

Mounted jsdom coverage for [`MfaChallenge`](../src/auth/MfaChallenge.tsx.md) with a session source restored as `VERIFICATION_REQUIRED`, one case using the real session client over [`fakeApi`](fakeApi.ts.md) routes, and a mocked router.

## Verification

- One labelled numeric field with `one-time-code` autocomplete and `maxlength` 7, a POST form, no alert, and no backup-code link (Ticket 09).
- Success: the digits are sent without spaces, `Verify` reads `Verifying…` while busy, and the guard opens `/staff`; with the real client the verify request carries the restricted Bearer token.
- `MFA_CODE_INVALID`: alert, cleared and focused field, no redirect. `TOO_MANY_ATTEMPTS`: focused alert and disabled form.
- `MFA_REQUIRED`, `INVALID_REQUEST` and `INVALID_RESPONSE` show their `errors` copy.
- A malformed code is refused without an API call.
- `Sign out` ends the session and returns to `/sign-in`; an enrollment-required session is sent to setup.
