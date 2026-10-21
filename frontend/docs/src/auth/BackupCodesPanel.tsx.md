# `src/auth/BackupCodesPanel.tsx`

Source: [`src/auth/BackupCodesPanel.tsx`](../../../src/auth/BackupCodesPanel.tsx)

## Purpose

Shows the ten backup codes issued when a staff member activates an authenticator. The API returns them only in that one response, so this panel is the only time they are visible. It follows the "Backup codes (shown once)" state of `agent-docs/ui-design/staff-mfa-enroll.html`.

## Export

### `BackupCodesPanel({ codes, onSaved, notice?, steps? })`

Renders both steps as done, the heading `Backup codes (shown once)` (focused on mount, because it replaces the setup form), the warning `Save these now. Each works once if you lose your phone.`, the codes as a labelled list, a `Copy all` button and the primary `I’ve saved them` button.

## Observable behavior

- **Copy all** writes the codes, one per line, with `navigator.clipboard.writeText` and shows a `Copied` status. If the browser denies the clipboard or has none (an insecure context), a danger alert asks the user to select and copy the codes themselves.
- **I’ve saved them** calls `onSaved` (the caller forgets the codes) and then `router.replace('/staff')`.

The codes are held only in the caller's React state ([`MfaEnrollment`](MfaEnrollment.tsx.md)); the panel never writes them to storage, the URL or the console.

## Design deviations

Ten codes are shown instead of the mock's eight (accepted decision D4). The design's small `Copy all` button uses the regular size so the target stays at least 44 px.

## Verification

[`tests/BackupCodesPanel.test.ts`](../../tests/BackupCodesPanel.test.ts.md) covers the list, copy success, clipboard denial and absence, and the saved action.

## Ticket 09

An optional `notice` renders above the codes inside the secret panel: `SENT` uses a success status; `FAILED`, `NO_VERIFIED_CONTACT` and `NOT_CONFIGURED` use warning statuses. All copy comes from `staffMfa.contactNotice`. An absent or null notice renders none. `steps` defaults to true; regeneration passes false to omit enrollment progress. The caller still owns code lifetime and session visibility.
