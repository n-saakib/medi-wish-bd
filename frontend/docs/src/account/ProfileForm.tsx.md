# `src/account/ProfileForm.tsx`

Source: [`src/account/ProfileForm.tsx`](../../../src/account/ProfileForm.tsx)

## Purpose and behavior

`ProfileForm()` renders the guarded `/account/profile` card from the account profile design. It loads the caller's profile through the session client, shows Username and current Mobile as text, and edits Full name, Email and Date of birth; the latter two labels explicitly include `(optional)`. A text chip distinguishes verified from unverified mobile. The form validates its three editable fields before sending a save with the loaded version; a successful response becomes the new baseline and focuses the success status. A stale error offers Reload, and an account-closing error disables edits. Pending mobile remains visible in the closing state.

Only one profile request runs at a time. The request runner returns true only after applying the answer to the current session; skipped or obsolete requests return false, so the mobile dialog stays open with its draft when nothing was staged. Save disables editable fields; save, stage and cancel disable competing commands. Each answer is applied only while this form is mounted and the same session generation is current. The generation changes on authentication transitions but stays stable across access-token refresh. A mobile stage answer merges only current mobile, verification flag and pending mobile; cancel clears only pending mobile. Neither command replaces an unsaved field draft, its baseline or its loaded version. A later save can therefore report a real stale update from another tab.

## Verification and design deviations

[`tests/ProfileForm.test.tsx`](../../tests/ProfileForm.test.tsx.md) checks draft preservation, stale recovery, one in-flight save, dialog behavior, closure disabling every editable input and dropping an answer after a session change. Ticket 11 browser tests cover the journey and accessibility. The accepted flow adds Date of birth and omits the design's password link, fixed `+880` prefix and OTP step; mobile verification remains pending until a later ticket.

The exported ProfileForm guards the session and mounts a ProfileEditor keyed by generation. Changing or ending a session destroys every profile, draft, dialog and request marker; a failed new-session read cannot reveal retained fields from the previous User.

Closing the mobile dialog restores focus to Change only when it is enabled; otherwise the programmatically focusable Profile heading provides an available destination, including after an account-closing error.

Focus and announcements (2026-10-08): Full name has `maxLength` 100, the same `fullNameMaxLength` limit the validation uses. A refused save focuses the first invalid field, in page order, from an effect that runs after its error is linked and once the field is enabled. A save, cancel or load error alert (including the stale-update message) takes focus when shown. Reload moves focus to the Profile heading because the button disappears. A successful Cancel change shows and focuses a `Mobile change cancelled.` status; the notice clears on the next edit, save, reload, stage or cancel.

Closing-pass fixes (2026-10-08): a save or mobile command refused because the account is closing focuses the “Your account is closing.” warning; a page that loads an already-closing account does not move focus. The pending-mobile note is a status paragraph rendered before any number is staged, so “New number … is waiting for verification.” is announced when it appears; the Cancel change button sits beside it, outside the live region.

## Ticket 05 email recovery

Mobile and Email are separately named groups. A saved email shows its verification chip and Verify when unverified. A normalized email change or clear reveals Current password; blank values are refused locally and the password is sent verbatim only for changes, then cleared whenever the save settles. CURRENT_PASSWORD_INVALID is a focused field error. Verification issue/confirm/resend share the existing one-flight and session-generation guards. Confirmation updates only emailVerified when the saved email still matches, preserving draft, baseline and version; a changed address offers Reload. Account closure closes both dialogs and disables edits. The success notice takes focus after the native modal closes.
