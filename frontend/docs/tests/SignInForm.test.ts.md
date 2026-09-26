# `tests/SignInForm.test.ts`

Source: [`tests/SignInForm.test.ts`](../../tests/SignInForm.test.ts)

## Purpose

Mounted jsdom coverage for [`SignInForm`](../src/auth/SignInForm.tsx.md) through [`renderWithSession`](renderWithSession.ts.md). `next/navigation` is mocked (router plus a fixed `/sign-in` pathname) so redirects can be observed.

## Verification

- The form uses `method="post"`, labels both fields, shows no alert or status initially and links to `/register`.
- A submission calls `signIn` with the entered credentials, disables the button with `Signing in…` while pending, clears the password and redirects to `/account` on success.
- A failure shows exactly one alert with the generic translated message (not the error detail), clears the password, returns focus to the identifier and does not redirect; editing a field removes the alert.
- An expired session is shown as a focused status message, and a restore failure as an alert.
- The `accountCreated` notice set by registration is shown as a focused status message.
- With the real session client and a controlled fetch boundary, a successful sign-in leaves the window URL unchanged and the synthetic access token appears in no `history.pushState`/`replaceState` call or router call.

On 2026-09-26 this suite passed as part of `npm run test:unit` (8 files, 92 tests). It does not replace the browser journey against the running API.
