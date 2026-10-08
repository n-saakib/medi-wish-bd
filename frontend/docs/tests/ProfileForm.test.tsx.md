# `tests/ProfileForm.test.tsx`

Source: [`tests/ProfileForm.test.tsx`](../../tests/ProfileForm.test.tsx)

## Purpose

Mounted tests exercise the public `ProfileForm` with an injected session source and deferred API answers. jsdom's native dialog methods are stubbed; real native keyboard and focus behavior is covered by the browser acceptance spec.

## Observable coverage

- Initial GET loading, an unchanged profile's disabled Save and the unverified chip; a normalized save response becomes the next field/version baseline, disables Save and focuses the success notice.
- Duplicate-email and INVALID_REQUEST save failures show bounded translated copy while retaining the draft; failed GET and stale save offer Reload, which replaces fields and advances the version used by a later save.
- Invalid full name, email and date of birth produce linked field errors without sending PUT. A loaded closing account retains verified/current/pending mobile information while disabling profile commands; an ACCOUNT_CLOSING command failure also disables every editable input.
- Stage and cancel retain an unsaved draft and version. A held save excludes duplicate saves and mobile commands. Dialog Cancel sends no POST; successful stage closes and restores focus. Duplicate stage failure remains inside the dialog, and Escape restores focus.
- Session transitions discard old profile/draft data even when the new GET fails, and drop old save/stage completions even if sign-in reuses the same user object. An old stage cannot close a newer dialog or move its focus.
The successful-stage focus assertion reproduced a real disabled-button timing bug (RED on 2026-10-06). Native close/focus now follows the closing render; the closing notice assertion uses the existing warning status role.

The client-validation cases include a 102-unit trimmed name that would collapse to A B, proving the browser refuses it without issuing PUT. The accepted limit applies before internal-space collapse, matching the server validation rule.
