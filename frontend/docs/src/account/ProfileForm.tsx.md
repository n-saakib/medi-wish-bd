# `src/account/ProfileForm.tsx`

Source: [`src/account/ProfileForm.tsx`](../../../src/account/ProfileForm.tsx)

## Purpose and behavior

`ProfileForm()` renders the guarded `/account/profile` card from the account profile design. It loads the caller's profile through the session client, shows Username and current Mobile as text, and edits Full name, optional Email and Date of birth. A text chip distinguishes verified from unverified mobile. The form validates its three editable fields before sending a save with the loaded version; a successful response becomes the new baseline and focuses the success status. A stale error offers Reload, and an account-closing error disables edits. Pending mobile remains visible in the closing state.

Only one profile request runs at a time. Save disables editable fields; save, stage and cancel disable competing commands. Each answer is applied only while this form is mounted and the same session generation is current. The generation changes on authentication transitions but stays stable across access-token refresh. A mobile stage answer merges only current mobile, verification flag and pending mobile; cancel clears only pending mobile. Neither command replaces an unsaved field draft, its baseline or its loaded version. A later save can therefore report a real stale update from another tab.

## Verification and design deviations

[`tests/ProfileForm.test.tsx`](../../tests/ProfileForm.test.tsx.md) checks draft preservation, stale recovery, one in-flight save, dialog behavior, closure disabling every editable input and dropping an answer after a session change. Ticket 11 browser tests cover the journey and accessibility. The accepted flow adds Date of birth and omits the design's password link, fixed `+880` prefix and OTP step; mobile verification remains pending until a later ticket.

The exported ProfileForm guards the session and mounts a ProfileEditor keyed by generation. Changing or ending a session destroys every profile, draft, dialog and request marker; a failed new-session read cannot reveal retained fields from the previous User.
