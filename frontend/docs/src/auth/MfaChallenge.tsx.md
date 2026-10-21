# `src/auth/MfaChallenge.tsx`

Source: [`src/auth/MfaChallenge.tsx`](../../../src/auth/MfaChallenge.tsx)

## Purpose

Client component for `/staff/mfa`: the authenticator code a returning Admin or Moderator enters after the password. It follows `agent-docs/ui-design/staff-mfa.html`.

## Export

### `MfaChallenge()`

Uses `useSessionRedirect('mfa-challenge')`. For a `VERIFICATION_REQUIRED` session it renders `Verify it’s you`, `Enter the code from your authenticator app.`, an `Authenticator code` [field](AuthenticatorCodeField.tsx.md), `Verify`, a “Lost your phone?” button and `Sign out`. For any other session it shows a checking status while the guard redirects.

## Observable behavior

- **Verify.** A malformed code is refused locally. Otherwise the provider's `verifyMfa(digits)` runs with the button reading `Verifying…`; success makes the session `VERIFIED` and the guard opens `/staff`. The field is cleared after every attempt.
- **Errors.** `MFA_CODE_INVALID` shows the invalid-code alert and focuses the field; `TOO_MANY_ATTEMPTS` shows a focused alert and disables the form; other codes show their mapped `errors` copy, never the API text.
- **Sign out** ends the session through the provider; the guard then opens `/sign-in`.

## Design deviation

Ticket 09 delivers the design's recovery dialog. “Lost your phone?” is a link-styled button opening a native dialog rather than a placeholder anchor and static backdrop. Exhausted-code help says “Contact the store owner,” following accepted P12. Existing Sign out remains available. The native modal and existing controls retain 44 px targets and amber focus styling.

## Verification

[`tests/MfaChallenge.test.ts`](../../tests/MfaChallenge.test.ts.md).

The recovery trigger is hidden after an authenticator throttle lockout. Opening focuses the backup-code field; closing restores focus to the trigger. Successful redemption adopts replacement assurance and the existing guard opens `/staff/mfa/enroll`. See [`BackupCodeDialog`](BackupCodeDialog.tsx.md) for modal behavior.
