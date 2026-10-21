# `tests/MfaChallenge.test.ts`

Source: [`tests/MfaChallenge.test.ts`](../../tests/MfaChallenge.test.ts)

## Purpose

Mounted jsdom coverage for [`MfaChallenge`](../src/auth/MfaChallenge.tsx.md) with a session source restored as `VERIFICATION_REQUIRED`, one case using the real session client over [`fakeApi`](fakeApi.ts.md) routes, and a mocked router.

## Verification

- One labelled numeric field with `one-time-code` autocomplete and `maxlength` 7, a POST form, no alert and the “Lost your phone?” recovery trigger.
- Success: the digits are sent without spaces, `Verify` reads `Verifying…` while busy, and the guard opens `/staff`; with the real client the verify request carries the restricted Bearer token.
- `MFA_CODE_INVALID`: alert, cleared and focused field, no redirect. `TOO_MANY_ATTEMPTS`: focused alert, disabled form and hidden recovery trigger.
- `MFA_REQUIRED`, `INVALID_REQUEST` and `INVALID_RESPONSE` show their `errors` copy.
- A malformed code is refused without an API call.
- `Sign out` ends the session and returns to `/sign-in`; an enrollment-required session is sent to setup.

Ticket 11 aligns INVALID_REQUEST assertions with the shared bounded checkDetails copy: Check your details and try again. No API message is rendered.

Ticket 09 replaces the omitted-backup-code assertion with the recovery trigger. A real-client fake-API journey opens the modal, checks initial field focus, posts normalized backup input and asserts `/staff/mfa/enroll`. Authenticator lockout asserts that the recovery trigger is hidden. Native-dialog methods are stubbed only for jsdom.
