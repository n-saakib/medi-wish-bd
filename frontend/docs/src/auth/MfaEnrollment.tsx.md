# `src/auth/MfaEnrollment.tsx`

Source: [`src/auth/MfaEnrollment.tsx`](../../../src/auth/MfaEnrollment.tsx)

## Purpose

Client component for `/staff/mfa/enroll`: first-time or replacement authenticator setup for an Admin or Moderator whose session is restricted to enrollment. It follows `agent-docs/ui-design/staff-mfa-enroll.html`.

## Export

### `MfaEnrollment()`

Uses `useSessionRedirect('mfa-enrollment', { enabled })`. Once the restore reports `ENROLLMENT_REQUIRED` or `REPLACEMENT_REQUIRED`, it calls the provider's `startMfaEnrollment()` once and shows the step bar, `Set up your authenticator` (`Set up your new authenticator` for a replacement), the QR code, a `Can’t scan?` disclosure with the manual key in groups of four, and the `Enter the 6-digit code` field with `Verify`. While the setup loads it shows `Preparing your setup…` with `Verify` disabled.

## Observable behavior

- **QR code.** Drawn in the browser from the `otpauth://` URI with `qrcode`'s `toString(uri, { type: 'svg' })` and inserted as an SVG inside a `role="img"` element labelled `QR code to scan with your authenticator app`. The secret is never sent to a QR service. If drawing fails, the manual key still works.
- **Latest setup only (P4).** Each start is numbered and only the newest answer is shown, so a double start (strict mode, a quick reload, a back/forward restore) never shows or verifies an older secret.
- **Verify.** A malformed code is refused locally. Otherwise `verifyMfaEnrollment(enrollmentId, digits)` runs, with the button reading `Verifying…`. On success the secret is dropped and [`BackupCodesPanel`](BackupCodesPanel.tsx.md) shows the codes.
- **Errors.** `MFA_CODE_INVALID`: an alert with the invalid-code copy, and the field is cleared and focused. `MFA_ENROLLMENT_STALE`: a new setup starts at once and a focused warning says so. `TOO_MANY_ATTEMPTS`: a focused alert, and the field and button are disabled. Other failures show their mapped `errors` copy. A failed start shows a focused generic alert with `Try again`.
- **Redirect held for the codes (P3).** Verification makes the session `VERIFIED`, which the guard would send to `/staff` at once. The guard is disabled while a verification is in flight and while codes are shown to a verified session; `I’ve saved them` re-enables it.
- **Secret lifetime (P5).** The secret and the codes live only in this component's state. They are dropped on unmount and on `pagehide`, so the back/forward cache cannot keep them; a page restored from that cache (`pageshow` with `persisted`) starts a fresh setup. Nothing is written to `localStorage`, `sessionStorage`, the URL or the console. The `/staff/*` routes also send `Cache-Control: no-store` (see [`next.config.ts`](../../next.config.ts.md)).

## Design deviations

The six digit boxes are one [code field](AuthenticatorCodeField.tsx.md), and there are ten backup codes instead of eight.

## Verification

[`tests/MfaEnrollment.test.ts`](../../tests/MfaEnrollment.test.ts.md).

Staff UI correction (2026-10-08): the mount effect reuses a start that is still in flight, so React StrictMode re-running the effect in `next dev` sends one `POST /api/auth/mfa/enrollment`, not two whose first secret is already superseded. Genuine restarts (`Try again`, the `MFA_ENROLLMENT_STALE` restart and a back/forward-cache restore) always start a new setup. The heading is focusable, and `Try again` moves focus to it because the button is removed.

## Ticket 09 replacement and privacy

A replacement start remembers the mode for this page view, showing “Set up your new authenticator” and “Your old authenticator stops working once this one is verified.” Verification shows the returned codes with the contact-notice outcome. First enrollment has no notice. Existing QR generation, latest-start handling, restart/lockout behavior, once-only code hold and `pagehide` clearing apply to both modes.

Code panels render only while the session still has a profile and `VERIFIED` assurance. Losing that session hides the codes and releases the redirect hold, including sign-out from the staff header. This corrects an existing path that could leave codes displayed after sign-out. The accepted guard hold therefore differs from the plan's literal original expression only when session access is lost.

Design differences retained: the single numeric field replaces six boxes and ten codes replace the mock's eight. Replacement-specific copy and the notice reflect the accepted Ticket 09 contract.

A local display epoch also invalidates pending verification results on pagehide or unmount. A late success cannot repopulate once-only codes, and a late failure cannot restart hidden setup. A successful verification in the current view still shows its codes normally. The deferred-verification regression reproduced the late-success display before the correction.
