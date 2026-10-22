# `src/auth/BackupCodeDialog.tsx`

Source: [`src/auth/BackupCodeDialog.tsx`](../../../src/auth/BackupCodeDialog.tsx)

## Purpose and props

`BackupCodeDialog({ open, onClose, returnFocus })` lets a staff member who has passed the password challenge redeem a saved backup code. Success adopts `REPLACEMENT_REQUIRED` through the session provider; the challenge guard continues to new-authenticator setup. The code remains transient component state.

## Behavior

The native modal uses existing profile-dialog, row and action styles. Opening explicitly focuses the labelled backup-code field. Document order is Close, code field, Cancel, Continue; Tab wraps within enabled controls in both directions. The field disables autocomplete and spellchecking, requests character capitalization and accepts padded/spaced input without a truncating maximum length.

`backupCodeInput` validates and formats a D4 code before calling `redeemBackupCode`. Malformed input sends nothing and gets a linked danger alert. A request disables all controls, uses “Checking…” and prevents Escape or duplicate submission. A refused code clears the field and refocuses it after re-enabling. Throttle lockout disables the field and Continue while leaving Cancel and Close available. Other failures use bounded translated error copy; current-session `401` expiry remains the provider's responsibility.

Cancel, Close, Escape and a native close event clear entered code/error, close the modal and hand focus back through `returnFocus` (the host restores its trigger, or focuses its lock alert after a lockout). `onClose(locked)` reports whether the dialog ended in throttle lockout, so the host can lock its own shared-throttle form. A queued native close event cannot dismiss a reopened dialog. No credential enters storage, history or navigation arguments.

## Design decisions

The layout follows `staff-mfa.html`. Accepted differences are native `<dialog>` instead of the prototype backdrop, real buttons instead of placeholder anchors, and the instruction to contact the store owner when codes are exhausted. Existing 44 px controls and amber focus styling are reused. The owner accepted the document order above with initial field focus.

## Verification

[`tests/BackupCodeDialog.test.tsx`](../../tests/BackupCodeDialog.test.tsx.md) covers labels/order, validation/request mapping, disabled and locked states, closure, refocus, keyboard boundaries, stale close events and credential privacy. Real browser dimensions and keyboard traversal remain the Ticket 09 browser gate.
