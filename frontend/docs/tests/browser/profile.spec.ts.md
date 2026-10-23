# `tests/browser/profile.spec.ts`

Source: [`../../../tests/browser/profile.spec.ts`](../../../tests/browser/profile.spec.ts)

## Purpose

The Ticket 11 browser acceptance tests, E2E-11-33 to E2E-11-48, E2E-11-52 and E2E-11-53 (added 2026-10-04, after the API IDs). They run the real frontend build against the real test API on the `chrome` and `msedge` projects.

Each is tagged `@t11` and `@t11-T5`: they first pass when sub-ticket T5 joins the page (T3) to the API (T4). E2E-11-47 also carries `@smoke`. Control names and copy follow plan §4.6 and §10, and the shared strings come from `copy` in [`profileSupport.ts`](profileSupport.ts.md). Button names are matched with `exact: true`.

API set-up that signs in, such as staging a mobile in 35, 44 and 45, uses Playwright's separate `request` context, never `page.request`. `page.request` shares the browser's cookies, so signing in through it gives the page a session and the sign-in page then skips to `/account`. Registering through `page.request` is safe because it opens no session. E2E-11-48 signs in through `page.request` on purpose, to leave the verified staff session in the browser.

The spec's `holdRequests(page, method, path)` intercepts every request of one method to a profile route. It records each request when the page dispatches it, so a duplicate counts however late it would be answered, and holds it until `release()`; later requests pass straight through and are still recorded. `statuses()` lists one entry per real attempt (`undefined` while unanswered) and leaves out a `401` that the session client refreshes and retries.

`expectLayout`, `accentColour` and `expectKeyboardOrder` moved to [`recoverySupport.ts`](recoverySupport.ts.md) so the Ticket 05 browser spec shares them. The layout check now also catches sideways overflow inside an open dialog and checks its horizontal viewport bounds.

Ticket 05's accepted email contract adds an Email status group and requires the current password for a changed or cleared email. The profile locators scope mobile status chips to the Mobile group, and the email textbox uses its role and name. These expectations are authored ahead of the Ticket 05 production implementation.

## Tests

| ID | Checks |
| --- | --- |
| 33 | The full journey, which runs through these steps: <br>1. Register, then follow `/account` → `Edit profile` to `/account/profile`, where the heading is `Profile`. <br>2. Check the registered values: the username is text, not a field, and the Mobile group shows `Not verified`. `Save changes` is disabled. <br>3. Change the email and enter the current password; save the normalized values and focus `Profile saved.`. The `PUT` has exactly five keys, including `currentPassword` and version 0; the password field disappears after saving. <br>4. Reload, and the values persist. <br>5. Stage a mobile with `Change` → `Save for verification`; the `POST` body is exactly `{mobile}`, the pending note appears and the current number stays. The pending number survives a reload. <br>6. `Cancel change` sends a `DELETE` with no body, answered `204`, and focuses the `Mobile change cancelled.` status. <br>7. `/account` shows the new email, and after signing out, the new email signs in. |
| 34 | Two tabs: the outdated tab's save shows and focuses the `staleUpdate` alert. `Reload` shows the newer values and focuses the `Profile` heading, and a save after that succeeds. |
| 35 | The account starts closing while the page is open. The next save shows `Your account is closing.` and the page becomes read-only; it stays read-only after a reload, which still shows the pending number. |
| 36 | A signed-out visitor opening `/account/profile` is sent to `/sign-in`, and no profile request is sent at all: `recordProfileRequests` keeps requests answered `401`, so a premature read fails the test. |
| 37 | Client field errors for a date of birth of tomorrow in Dhaka or before 1900 and a bad email. Each error is announced through `aria-invalid` and the accessible description, the invalid field is focused, and nothing is sent. Full name has `maxlength` 100; its over-length error is covered by the unit tests. Clearing the registered email reveals Current password; the valid boundary values save with it. |
| 38 | In an `America/Los_Angeles` browser with a fixed clock, tomorrow in Dhaka is refused and today in Dhaka is saved. |
| 39 | Changing to another User's email in upper case, with the correct current password, shows the `duplicateUser` alert, and nothing is stored. |
| 40 | The page's `PUT` is rewritten to `1990-02-30`, so the real API refuses it; the page shows `Check your details and try again.` |
| 41 | The `Change mobile` dialog: `Enter` opens it with focus inside. It has one field, `New mobile`, and no code field or `Send code`. `Escape` and `Cancel` close it with no request and return focus to `Change`. A number another User holds, and the current number, show errors inside the dialog; after the first, focus is back on `New mobile`. A second stage replaces the first. |
| 42 | `Save changes` is disabled until something changes. Every `PUT` and `POST` is held and counted when dispatched: a double click on `Save changes` shows a disabled `Saving…` and dispatches one `PUT`, and a double click on `Save for verification` dispatches one `POST`. After release, the whole test has dispatched exactly one of each (`200`, `202`), and the version is 1. |
| 43 | With a verified current mobile, the chip reads `Verified`; a pending change keeps it verified and keeps the current number. |
| 44, 45 | At 375 px and 1280 px, with a pending change: <br>- the page and the dialog do not scroll sideways; <br>- every input has a label; <br>- every control is at least 44 px in both dimensions; <br>- `Tab` reaches every control in page order, each with the amber `--accent` focus ring; <br>- the open dialog keeps focus inside it while the document has focus, and browser-chrome focus after its last control is allowed; <br>- `Escape` returns focus to `Change`. |
| 46 | Privacy: the full name, the emails, the date of birth, current password and the mobiles (current, pending and another User's) appear in none of the backend log, the console, request and navigation URLs, storage, or history state, whether as typed, percent-encoded or form-encoded (`+` for a space); URLs are scanned raw and decoded. Storage is sampled after entering Current password, date of birth, the duplicate mobile and the pending mobile, and after save, reload and cancellation. The backend log must contain response-status events, which proves it was read. |
| 47 | `@smoke`: a Customer saves a full name, and a future date of birth is refused. |
| 48 | An MFA-verified Admin, whose only role is ADMIN (no `CUSTOMER` role; DECISIONS S6), signs in and enrolls through `page.request`, opens `/account/profile` and saves. |
| 52 | One profile request at a time (plan §4.6), with a pending change staged first. While a held save is open: `Saving…`, `Change` and `Cancel change` are disabled and the three fields cannot be edited; after release the saved name and the pending note show. While a held stage is open, `Save for verification` is disabled and one `POST` is dispatched; its answer keeps the saved name. A name is then edited but not saved, and while a held cancel is open, `Change`, `Cancel change` and `Save changes` are disabled, and `Enter` in the field dispatches no `PUT`; after release the unsaved name stays and `Save changes` is enabled again. The next save is answered `200`, not stale, so the page holds the latest version; the database has version 2 and no pending change. |
| 53 | Mobile answers keep the draft (plan §4.6). The page loads version 0, another session saves a name (version 1), and the page edits the name without saving. A stage through the dialog (`202`, whose body carries the newer profile) and then `Cancel change` (`204`) show and clear the pending note but keep the unsaved name, and `Save changes` stays enabled. Saving then sends version 0 and shows the `staleUpdate` alert (`409`); the database keeps the other session's name at version 1 with no pending change. |

## Running

```bash
npm run test:browser -- --grep @t11-T5
```

Run only one browser suite at a time on a machine, because the ports are fixed.

E2E-11-41 also asserts native focus returns to Change after a successful asynchronous stage and replacement, protecting the closing-render timing regression found by mounted units on 2026-10-06.
