# `tests/SignInForm.test.ts`

Source: [`tests/SignInForm.test.ts`](../../tests/SignInForm.test.ts)

## Purpose

Mounted jsdom coverage for [`SignInForm`](../src/auth/SignInForm.tsx.md) through [`renderWithSession`](renderWithSession.ts.md). `next/navigation` is mocked (router plus a fixed `/sign-in` pathname) so redirects can be observed. [`installFakeLocks`](fakeApi.ts.md) gives the real session client the cross-tab lock of a secure context, which jsdom lacks.

## Verification

- The form uses `method="post"`, labels both fields, shows no alert or status initially and links to `/register`.
- A submission calls `signIn` with the entered credentials, disables the button with `Signing in…` while pending, clears the password and redirects to `/account` on success. A staff sign-in with status `ENROLLMENT_REQUIRED`, `VERIFICATION_REQUIRED` or `VERIFIED` goes to `/staff/mfa/enroll`, `/staff/mfa` or `/staff` instead.
- A failure shows exactly one alert with the generic translated message (not the error detail), clears the password, returns focus to the identifier and does not redirect; editing a field removes the alert.
- With the real session client, a login `401` `AUTHENTICATION_FAILED` shows `Those details don’t match an account.` while the API sends a different message.
- An expired session (a real client whose refresh answers `401`) is shown as a focused status message, and a restore failure as an alert.
- The `accountCreated` notice set by registration is shown as a focused status message.
- With the real session client, a `204` restore and a controlled fetch boundary, a successful sign-in leaves the window URL unchanged and the synthetic access token appears in no `history.pushState`/`replaceState` call or router call.

On 2026-09-27 this suite passed as part of `npm run test:unit`. It does not replace the browser journey against the running API.

Ticket 09 adds `REPLACEMENT_REQUIRED` to the staff sign-in routing table, targeting `/staff/mfa/enroll`.
