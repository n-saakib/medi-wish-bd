# `src/account/MobileChangeDialog.tsx`

Source: [`src/account/MobileChangeDialog.tsx`](../../../src/account/MobileChangeDialog.tsx)

## Purpose and behavior

`MobileChangeDialog()` is the native modal opened by **Change** on the profile. It has one New mobile field, Cancel and Save for verification. Submission delegates to `ProfileForm`, which sends the authenticated stage request; a bounded API error appears inside the dialog, and a successful stage closes it and returns focus to Change. Escape and Cancel close without sending a request when no submission is pending. During submission the mobile field and dialog buttons are disabled and repeated submissions are ignored. The API decides mobile validity; there is no client mobile rule, SMS dispatch, code field or activation route in Ticket 11.

## Verification

[`tests/ProfileForm.test.tsx`](../../tests/ProfileForm.test.tsx.md) stubs jsdom's missing native dialog methods and checks opening, focus, a duplicate error and Escape. Browser E2E-11-41 checks native keyboard and focus behavior.

The dialog checks its mounted marker after await before changing local state, closing the parent or returning focus. An old-session stage response cannot close a new-session dialog or steal its focus.

Focus returns after the parent closes the dialog and commits enabled controls. The open-state effect closes the native dialog and restores Change focus, so a successful asynchronous stage cannot focus a still-disabled button. Mounted guards continue to discard old-session callbacks.
