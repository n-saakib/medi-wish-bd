# `src/auth/RegistrationForm.tsx`

Source: [`src/auth/RegistrationForm.tsx`](../../../src/auth/RegistrationForm.tsx)

## Purpose

Client component for the `/register` page. It creates a customer account through [`registerUser`](../lib/user.ts.md) and then signs the new user in with the same credentials, following accepted decision D1. It follows `agent-docs/ui-design/register.html`.

## Export

### `RegistrationForm()`

Renders the `Create an account` heading, an optional danger alert, a form with username, mobile, optional email and password fields, a full-width submit button and a `Sign in` link to `/sign-in`. It calls `useSessionRedirect('guest')`. Browser constraints are username 3–50 characters, mobile up to 30, email up to 320 and password 12–128 (the backend's password range), with the hint `At least 12 characters` linked to the password by `aria-describedby`. The API remains the authority for validation.

## Observable behavior

- **Submit.** The form has `method="post"`, so a submission before hydration never puts credentials in the URL. On submit the password is cleared from component state, the button is disabled and reads `Creating account…`, and a blank email is omitted from the request.
- **Registration failure.** An `INVALID_REQUEST` response shows the translated username-rule message (`register.invalid`), including the rule that a username needs at least one letter. Other failures show the `errors` copy that [`errorMessageKey`](../lib/api.ts.md) picks for the code, such as the duplicate-user message for `DUPLICATE_USER`, or the generic message; the API's message text and transport details are never shown. The button is re-enabled; editing any field removes the alert.
- **Registration success.** Any `201` counts; the response body is not needed. The form calls the provider's `signIn` with the submitted identifier (username) and password. On success the guest redirect opens `/account`.
- **Follow-up sign-in failure.** The account exists, so the form sets the `accountCreated` notice and calls `router.replace('/sign-in')`, where the notice asks the visitor to sign in. No username, mobile, email or password is placed in the URL.

## Design deviations

The `+880` mobile prefix, the Terms/Privacy consent line and the OTP verification step are omitted; mobile verification is on hold. The password hint reads `At least 12 characters` (the design shows 10) to match the API's 12-character minimum.

## Verification

[`tests/RegistrationForm.test.ts`](../../tests/RegistrationForm.test.ts.md) covers the fields and hint, the request body with and without email, busy state and password clearing, the automatic sign-in after a `201` with an empty body and both redirect outcomes, and the duplicate-user (while the API sends a different message), invalid-request and transport-failure alerts. Browser verification is recorded in the Ticket 03.01 evidence.
