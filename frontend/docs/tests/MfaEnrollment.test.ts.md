# `tests/MfaEnrollment.test.ts`

Source: [`tests/MfaEnrollment.test.ts`](../../tests/MfaEnrollment.test.ts)

## Purpose

Mounted jsdom coverage for [`MfaEnrollment`](../src/auth/MfaEnrollment.tsx.md) and, through it, [`BackupCodesPanel`](../src/auth/BackupCodesPanel.tsx.md), using [`renderWithSession`](renderWithSession.ts.md), a session source restored as `ENROLLMENT_REQUIRED`, synthetic secrets and codes from [`fakeApi`](fakeApi.ts.md), and a mocked router.

## Verification

- The QR image (a real `qrcode` SVG) with its label, the `Can’t scan?` key in groups of four, and the code field's label, `inputmode`, `autocomplete` and `maxlength`.
- A preparing status with `Verify` disabled until the setup arrives.
- Happy path: `287 082` is sent as `287082` with the enrollment id; the focused backup-code heading and all ten codes appear, the secret is gone, and no redirect fires until `I’ve saved them`, which opens `/staff` and removes the codes.
- A malformed code is refused without an API call.
- `MFA_CODE_INVALID`: alert copy, cleared and focused field. `MFA_ENROLLMENT_STALE`: a second start, the restart notice, the new key, and the next verify uses the new enrollment id. `TOO_MANY_ATTEMPTS`: focused alert, disabled field and button.
- Only the latest start is shown when an older start answers last.
- A failed start offers `Try again`.
- `pagehide` removes the secret, and a persisted `pageshow` starts a new setup; `pagehide` removes shown backup codes; unmount leaves neither in the document.
- Spies prove no `localStorage` or `sessionStorage` call, no URL or history change, and no secret or code in console, history or router calls.
- A session that is not `ENROLLMENT_REQUIRED` starts no setup and is redirected.
