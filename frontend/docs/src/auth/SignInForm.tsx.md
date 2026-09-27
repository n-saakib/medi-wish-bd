# `src/auth/SignInForm.tsx`

Source: [`src/auth/SignInForm.tsx`](../../../src/auth/SignInForm.tsx)

## Purpose

Client component for the `/sign-in` page: identifier-and-password sign-in against the shared session, with the notices that bring a visitor here. It follows `agent-docs/ui-design/sign-in.html`.

## Export

### `SignInForm()`

Renders the `Sign in` heading, at most one alert, a form with a `Mobile, email or username` field (`autocomplete="username"`) and a password field (`autocomplete="current-password"`), a full-width submit button and a `Create an account` link to `/register`. It calls `useSessionRedirect('guest')`.

## Observable behavior

- **Submit.** The form has `method="post"`, so a submission before hydration never puts credentials in the URL; after hydration the handler prevents the default submission and calls the provider's `signIn`. The button is disabled and reads `Signing in…` while the provider's `signingIn` is set.
- **Success.** The password is cleared and the guest redirect opens the page for the session's MFA status: `/account` for a Customer or Delivery Person, `/staff/mfa/enroll` for an Admin or Moderator without an authenticator and `/staff/mfa` for one with an authenticator. The form does not navigate explicitly.
- **Failure.** One danger alert shows the `errors` copy that [`errorMessageKey`](../lib/api.ts.md) picks for the error code: `Those details don’t match an account.` for `AUTHENTICATION_FAILED`, otherwise the invalid-response or generic message. The API's own message text is never shown. The password is cleared and focus returns to the identifier field. Editing either field removes the alert.
- **Notices.** When no error is shown, the provider's notice appears only if it occurred: `sessionExpired` as a warning, `restoreError` as a danger alert and `accountCreated` (after a registration whose automatic sign-in failed) as a success alert. Each notice receives focus when shown so it is announced even though it replaces the page's context.

## Design deviations

The design's `Forgot?` password-recovery link is omitted because recovery is not implemented in this slice. Its note about the staff MFA step is also omitted: staff reach the MFA pages directly after sign-in, so the note is not needed.

## Verification

[`tests/SignInForm.test.ts`](../../tests/SignInForm.test.ts.md) covers labels and POST default, busy state, success redirect (including the staff landing pages), the failure alert and focus, the sign-in failure copy while the API sends a different message, notice rendering (the expiry notice through a real client whose refresh answers `401`), and an access-token privacy check with the real session client. Browser verification is recorded in the Ticket 03.01 evidence.
