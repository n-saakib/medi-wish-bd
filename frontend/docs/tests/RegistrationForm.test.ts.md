# `tests/RegistrationForm.test.ts`

Source: [`tests/RegistrationForm.test.ts`](../../tests/RegistrationForm.test.ts)

## Purpose

Mounted jsdom coverage for [`RegistrationForm`](../src/auth/RegistrationForm.tsx.md) through [`renderWithSession`](renderWithSession.ts.md). The registration request goes through a stubbed global `fetch`; the follow-up sign-in uses the injected session source, and `next/navigation` is mocked (router plus a fixed `/register` pathname).

## Verification

- The form uses `method="post"`, labels email as `Email (optional)`, requires 12 password characters with the `At least 12 characters` hint linked by `aria-describedby`, links to `/sign-in` and shows no alert initially.
- A submission posts to `/api/auth/register` without a blank email, clears the password, disables the button with `Creating account…`, keeps it disabled while the follow-up sign-in is pending, then, after a `201` with an empty body, signs in with the same credentials and redirects to `/account`.
- A filled-in email is sent.
- When the automatic sign-in fails, the form redirects to `/sign-in` only, and no username, mobile or password appears in any router call.
- A `DUPLICATE_USER` response shows the `errors.duplicateUser` copy while the API sends a different message, re-enables the button, keeps the password cleared and skips sign-in.
- An `INVALID_REQUEST` response shows the translated username-rule message, including the at-least-one-letter rule.
- A transport failure shows the generic translated message without its detail.

On 2026-09-26 this suite passed as part of `npm run test:unit`.
