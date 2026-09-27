# `src/auth/MfaChallenge.tsx`

Source: [`src/auth/MfaChallenge.tsx`](../../../src/auth/MfaChallenge.tsx)

## Purpose

Client component for `/staff/mfa`: the authenticator code a returning Admin or Moderator enters after the password. It follows `agent-docs/ui-design/staff-mfa.html`.

## Export

### `MfaChallenge()`

Uses `useSessionRedirect('mfa-challenge')`. For a `VERIFICATION_REQUIRED` session it renders `Verify it’s you`, `Enter the code from your authenticator app.`, an `Authenticator code` [field](AuthenticatorCodeField.tsx.md), `Verify` and a `Sign out` button. For any other session it shows a checking status while the guard redirects.

## Observable behavior

- **Verify.** A malformed code is refused locally. Otherwise the provider's `verifyMfa(digits)` runs with the button reading `Verifying…`; success makes the session `VERIFIED` and the guard opens `/staff`. The field is cleared after every attempt.
- **Errors.** `MFA_CODE_INVALID` shows the invalid-code alert and focuses the field; `TOO_MANY_ATTEMPTS` shows a focused alert and disables the form; other codes show their mapped `errors` copy, never the API text.
- **Sign out** ends the session through the provider; the guard then opens `/sign-in`.

## Design deviation

The design's `Lost your phone?` link and backup-code dialog are omitted: backup-code sign-in belongs to Ticket 09. `Sign out` takes its place, so a staff member without the phone can leave the restricted session.

## Verification

[`tests/MfaChallenge.test.ts`](../../tests/MfaChallenge.test.ts.md).
