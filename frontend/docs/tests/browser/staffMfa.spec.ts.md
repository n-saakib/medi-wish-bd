# `tests/browser/staffMfa.spec.ts`

Source: [`../../../tests/browser/staffMfa.spec.ts`](../../../tests/browser/staffMfa.spec.ts)

## Purpose

The Ticket 06 staff MFA journeys against the real test API, run on the `chrome` and `msedge` projects. Admin rights are granted with [`grantRole`](testApi.ts.md) in the run's schema, as an operator would. Codes come from the page's manual key through [`totp.ts`](totp.ts.md). `registeredAdmin` and `enroll` come from [`support.ts`](support.ts.md), where Ticket 08 moved them so the staff role specs share them.

## Tests

- **`@smoke an Admin sets up an authenticator and reaches the staff page`** — the shortest path. It registers through the API, grants ADMIN, signs in, enrolls with the current code, saves the backup codes and sees verified access on `/staff`. Run it with `npx playwright test --grep @smoke`, which since Ticket 08 also runs that ticket's smoke test (`E2E-08-46`).
- **A Customer opening `/staff` is sent to their account** — a registered Customer lands on `/account`.
- **Full journey:**
  1. Register through the form, have ADMIN granted, and sign out.
  2. A password sign-in lands on `/staff/mfa/enroll` with the QR image.
  3. The code from the manual key shows ten focused backup codes, and the page does not move until `I’ve saved them`.
  4. `/staff` shows the username, the one role `Admin`, and no `Super Admin` label: only the provisioned first Admin is Super Admin.
  5. A reload keeps verified access.
  6. The staff header's `Sign out` returns to `/sign-in`.
  7. Signing in again lands on `/staff/mfa`.
  8. A wrong code shows `The code is invalid or has already been used.`, clears and focuses the field, and stays on `/staff/mfa`. Exactly one `400 POST /api/auth/mfa/verify` and its console line are recorded.
  9. The code for the step after the enrollment's reaches `/staff`, with `200 POST /api/auth/mfa/verify` and `200 GET /api/staff/me` and no console error.

## Verification

On 2026-09-27 all three tests passed on Chrome 154.0.8037.57 and Edge 154.0.4258.37 as part of `npm run test:browser`.
