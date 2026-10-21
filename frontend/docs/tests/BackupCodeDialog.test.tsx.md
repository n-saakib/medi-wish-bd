# `tests/BackupCodeDialog.test.tsx`

Source: [`tests/BackupCodeDialog.test.tsx`](../../tests/BackupCodeDialog.test.tsx)

## Purpose and coverage

Mounted jsdom coverage for the native backup-code modal uses real session/translation providers, synthetic values and native-dialog method stubs. Initial field focus is performed by the component, rather than the stub. Tests assert the accessible heading/field attributes and Close → field → Cancel → Continue document order.

Behavior cases cover malformed local rejection and linked alert, normalized request mapping through the real session client, all-controls busy state with Escape/duplicate-submit prevention, bounded invalid/locked/generic errors, post-request field focus, three close actions clearing state and restoring trigger focus, Tab wrap and stale native-close events. Storage/history spies and router arguments protect credential boundaries. Browser gates separately verify actual keyboard traversal, 44 px dimensions and viewport fit.
