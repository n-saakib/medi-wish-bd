# `src/staff/BackupCodesRegeneration.tsx`

Source: [`src/staff/BackupCodesRegeneration.tsx`](../../../src/staff/BackupCodesRegeneration.tsx)

## Purpose and export

`BackupCodesRegeneration()` is the client form at `/staff/backup-codes`. Only a restored `VERIFIED` session sees it; the existing staff guard redirects other sessions. It uses the established auth-card and authenticator step-up patterns because no dedicated static design exists.

## Behavior

The labelled numeric field accepts six digits with the existing optional separating space. Invalid format is refused locally and focuses the field. Submission calls the provider's `regenerateBackupCodes(digits)` with “Getting codes…” and a disabled field/button. Bounded failure copy appears in a danger alert; rejected codes are cleared and the field is focused after it is enabled. Lockout disables the field and submit button. A secondary link returns to `/staff`.

Success shows ten codes through `BackupCodesPanel` without setup steps or a contact notice. The guard hold continues until “I’ve saved them” forgets the codes and opens `/staff`; loss of the verified session hides the codes and releases the hold. Codes remain in component state only. `pagehide` clears them and entered digits, and a request completed after pagehide or unmount cannot redisplay them.

## Verification

[`tests/BackupCodesRegeneration.test.tsx`](../../tests/BackupCodesRegeneration.test.tsx.md) exercises request mapping through the real session client, format and API failures, busy state, code lifetime and guards.
