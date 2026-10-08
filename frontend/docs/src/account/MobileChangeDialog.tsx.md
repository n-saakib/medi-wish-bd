# `src/account/MobileChangeDialog.tsx`

Source: [`src/account/MobileChangeDialog.tsx`](../../../src/account/MobileChangeDialog.tsx)

## Purpose and behavior

`MobileChangeDialog()` is the native modal opened by **Change** on the profile. It has one New mobile field, Cancel and Save for verification. Submission delegates to `ProfileForm`, which sends the authenticated stage request; a bounded API error appears inside the dialog, and a stage confirmed as applied by the parent closes it and restores focus. A skipped request returns false and preserves the open dialog and entered number, rather than presenting an unsaved number as saved. Escape and Cancel close without sending a request when no submission is pending. During submission the mobile field and dialog buttons are disabled and repeated submissions are ignored. The New mobile field describes an externalized 11-digit hint and links any bounded submission error with `aria-describedby` and `aria-invalid`. The API decides mobile validity; there is no client mobile rule, SMS dispatch, code field or activation route in Ticket 11.

## Verification

[`tests/ProfileForm.test.tsx`](../../tests/ProfileForm.test.tsx.md) stubs jsdom's missing native dialog methods and checks opening, focus, a duplicate error and Escape. Browser E2E-11-41 checks native keyboard and focus behavior.

The dialog checks its mounted marker after await before changing local state, closing the parent or returning focus. An old-session stage response cannot close a new-session dialog or steal its focus.

Focus returns after the parent closes the dialog and commits enabled controls. The open-state effect closes the native dialog and restores Change focus when that control is enabled. If account closure or another request leaves Change disabled, the parent focuses the Profile heading instead; disabled controls are never the focus target. Mounted guards continue to discard old-session callbacks.

Error focus (2026-10-08): the New mobile field is disabled while a stage is pending, so a browser drops its focus. When the API refuses the number, the dialog sets a ref flag in its `catch` block, and an effect keyed on the submitting and disabled states focuses the field once it is enabled. The field's `aria-describedby` then includes the `role="alert"` error. Closing the dialog clears the flag.

Late close events (2026-10-08): `dialog.close()` queues its `close` event. Under load, Change can reopen the dialog before that event arrives, and the handler then closed the reopened dialog (browser E2E-11-41 failed this way twice in full runs). The handler now acts only when the native dialog is actually closed, so a late event from an earlier close is ignored.
