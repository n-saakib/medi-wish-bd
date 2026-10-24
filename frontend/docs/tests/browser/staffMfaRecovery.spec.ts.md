# `tests/browser/staffMfaRecovery.spec.ts`

Source: [`../../../tests/browser/staffMfaRecovery.spec.ts`](../../../tests/browser/staffMfaRecovery.spec.ts)

## Purpose

Ticket 09's browser journeys against the real test API: "Lost your phone?" on the code challenge, the backup-code dialog, the replacement setup and its notice, and the regeneration page (plan §4.6 and §10.2). Helpers come from [`staffMfaRecoverySupport.ts`](staffMfaRecoverySupport.ts.md). Tag `@t09-T5`. Written before the feature; the tests fail until T3's pages and T4's API are delivered.

## Tests

- **E2E-09-01:** a Moderator uses a backup code, sets up a new authenticator, sees "We sent a notice to your verified contacts." and 10 new codes, and reaches `/staff`; a second browser is signed out; a fresh step from the old authenticator, the used code and an old unused code are refused; the new authenticator signs in. The old code is read before the sign-in, and the challenge is reloaded before the new code, so the fixture's ten-second Bearer token is renewed rather than expiring during the TOTP wait.
- **E2E-09-02:** four wrong codes each show the invalid-code error and clear and focus the field; the fifth locks the dialog (field and Continue disabled, Cancel enabled). Cancelling focuses the parent lockout alert, hides "Lost your phone?" and disables the authenticator field and Verify. A correct authenticator code is then refused too, and no code is spent. Before that final check, it computes the fresh TOTP and reloads the challenge to renew the fixture's ten-second Bearer token; this keeps the assertion about the shared lockout after slow code checks rather than token expiry.
- **E2E-09-03:** reloading the replacement setup shows a new key, and that key completes the replacement.
- **E2E-09-06:** an Admin regenerates codes from the staff home link; the codes are held until saved; old codes are refused and a new one opens the setup.
- **E2E-09-09:** Cancel, Close and Escape each close the dialog, clear it and return focus to "Lost your phone?"; malformed codes show the format error as the field's description and send nothing.
- **E2E-09-10:** a code typed loosely is sent as `XXXX-XXXX` and accepted.
- **E2E-09-11:** the Super Admin recovers and stays Super Admin.
- **E2E-09-12:** a replacement session is sent back to `/staff/mfa/enroll` from staff, admin, account and sign-in pages, and still completes.
- **E2E-09-13:** a phone found mid-recovery still signs in another browser; after the replacement expires, verifying the new key ends on `/sign-in` and nothing is replaced.
- **E2E-09-14:** the regeneration link shows for Moderators, Admins and Super Admins; a Super Admin can open the regeneration page, and "Back to staff pages" returns to `/staff`; a session that still needs its code goes to `/staff/mfa`, a Customer to `/account`, and a signed-out visitor to `/sign-in`.
- **E2E-09-15:** a challenge locked by wrong authenticator codes hides "Lost your phone?".
- **E2E-09-16:** while the code is checked, Continue reads "Checking…", every control is disabled and Escape is ignored.

## Running

Build the backend jar, then `npm run test:browser -- --grep "@t09-T5" --project chrome`, never beside another browser run.
