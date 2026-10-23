# `tests/browser/recovery.spec.ts`

Source: [`../../../tests/browser/recovery.spec.ts`](../../../tests/browser/recovery.spec.ts)

## Purpose

These are the Ticket 05 browser acceptance tests, E2E-05-40 to E2E-05-59 (plan §10.4). Tests 55 to 59 cover page rules of plan §4.7 that the original table left out. They cover email verification on Profile and the email password reset. They run the real frontend build against the real test API on the `chrome` and `msedge` projects, and read codes from the run's mail capture directory through [`recoverySupport.ts`](recoverySupport.ts.md). All data is synthetic.

They were written test-first on 2026-10-16 and pass once T5 joins the pages (T3) to the API (T4). Every test is tagged `@t05` and `@t05-T5`, plus one area tag:

| Area tag | Tests |
| --- | --- |
| `@t05-reset` | 40, 41, 42, 44, 48, 50, 52, 53, 59 |
| `@t05-verify` | 49, 51, 57, 58 |
| `@t05-email-change` | 43, 54, 55 |
| `@t05-limits` | 56 |
| `@t05-a11y` | 45, 46 |
| `@t05-privacy` | 47 |

E2E-05-48 also carries `@smoke`.

## Local helpers

- **Request recording:**
  - `recordRecoveryCalls(page)` records each request to the four routes when it is dispatched, with its body, `Content-Type` and status. A retried `401` is left out.
  - `holdRequests` (copied from [`profile.spec.ts`](profile.spec.ts.md), plus `bodies()`) holds a confirm to prove the one-request-at-a-time rule.
- **Assertions:**
  - `expectFieldError` checks `aria-invalid`, the message within the accessible description (which may also hold a hint), and a visible error element containing that message referenced by an `aria-describedby` ID.
  - `expectReadOnly` checks the closing state, **Verify** included.
  - `expectAccentRing` checks the amber focus ring.
  - `pageAnswer` captures each reset response in the route handler before fulfilling it to the page, preserving its status, stable headers and body length even if a later navigation makes Playwright unable to retrieve the response body.
- **Navigation:**
  - `signInHere` signs in on the current `/sign-in` page, keeping its notice.
  - `signOut` signs out.
  - `tabTo` tabs to a control.
  - `mixedCase` alternates letter case.
- **Keyboard order:** `expectKeyboardOrderFromTop` checks keyboard order on the code step. That step exists only in React state, so it focuses a temporary marker at the top of `<body>` before running `expectKeyboardOrder`.

## Tests

| ID | Checks |
| --- | --- |
| 40 | The full journey: register, verify on Profile (with the focused notice and the chip after reload), sign out, then **Forgot password?** with a mixed-case, padded email. The code and a space-padded password reset the account. `/sign-in` announces it, the old password is refused, and the new one signs in. One notice is sent, counted after a later mail sentinel drains the single-worker queue. The exact request bodies are checked; the verification request has no body. |
| 41 | Wrong codes show the alert, empty and focus **Code**, and keep **New password**. Five void the code and the right one is then refused. After the 60-second gap, **Send a new code** creates a new stored code ID. Distinct old digits fail; the newly mailed digits reset even if the random six-digit value repeats. |
| 42 | Unknown, unverified and verified addresses give the same focused message and the same `202` answer, both as the page received it and sent directly. The browser route captures status, stable headers and the empty body before fulfilling each response. Only the verified address gets mail. |
| 43 | A new email shows **Current password**. Empty gives a client error with no `PUT`; wrong gives the API error, emptied and focused. The right one saves with `currentPassword` and shows Not verified. A notice goes to the old address. A name-only `PUT` has no `currentPassword` key. The old address then gets no reset code. |
| 44 | A reset in another browser revokes the open tab: its next save goes to `/sign-in` with the expiry notice and saves nothing. |
| 45, 46 | At 375 px and 1280 px: the **Forgot password?** target and ring, the layout and keyboard order of both forgot-password steps, and linked field errors with no request. The **Verify email** dialog opens with Enter, keeps document focus inside it on Tab while allowing native Chrome and Edge to move focus to browser chrome, fits, and returns focus to **Verify** on Escape. |
| 47 | The email, the codes and both passwords stay out of URLs, history, the console, storage, cookies and the API log. Storage and the browser-context cookie jar (including HttpOnly cookies) are sampled with the verification dialog open and its code filled, after confirmation, and while reset fields are filled. Cookie names and values are checked for tracked secrets; the established opaque `MW_REFRESH` value is excluded only from six-digit code matching when it has the backend's expected format and scope. The shared log scanner masks full UUIDs and ISO timestamps, then catches six-digit code tokens even after `.`, `:` or `-`. Boolean privacy assertions keep secret-bearing text out of ordinary failure output. A reload on the code step returns an empty email step, and `/forgot-password` never gains a query or hash. |
| 48 | Smoke: a verified Customer resets from sign-in and signs in with the new password. A 5-character password is refused on the page without a request. |
| 49 | A closing account: **Verify** gets `409` with the warning focused and the page read-only, and no mail is sent. A dialog opened before closing gets `409` on **Confirm** and closes, with nothing verified. |
| 50 | **Forgot password?** follows the **Password** label in DOM order, outside it. `/forgot-password` asks only for an email, shows help as plain text with no link, and sends signed-in visitors to `/account`. |
| 51 | **Send a new code** in the dialog gets the `429` alert inside the gap, then "A new code is on its way." The stored code ID changes; distinct old digits fail and the newly mailed digits verify, including a legitimate random-value repeat. |
| 52 | An Admin resets through the page; the new password leads to the authenticator challenge, not setup. |
| 53 | While a confirm is held, the page's other actions are disabled and Enter sends nothing: exactly one request. On the reset page this means **Resetting…** and **Send a new code**. On Profile it means **Confirm**, **Send a new code**, **Save changes** and **Change**, and the draft survives. |
| 54 | An email change in one browser revokes the other tab's session (`email-changed`). That tab's next save goes to `/sign-in`, while the changing browser stays signed in. |
| 55 | With no saved email there is no email chip, **Verify** or **Current password**. Setting, changing or clearing the email asks for **Current password**. A name edit saved with the address re-cased omits `currentPassword`, keeps verification and active sessions, and changes only the expected profile version. **Verify** is gone once verified, and the Mobile group keeps its own chip. |
| 56 | Five wrong current passwords each give a field error and an emptied field. The right one then gets the `429` page alert and saves nothing; after the hour it saves. |
| 57 | The **Verify email** dialog names the address and the 15-minute lifetime. Empty, short or non-digit codes get a linked field error with no request. **Cancel** sends nothing and returns focus to **Verify**. Reopened, the dialog is empty, and "123 456" is sent as six digits and verifies, which survives a reload. |
| 58 | **Verify** after the saved email was removed elsewhere gets `409`, the add-an-email alert and **Reload**; after **Reload** there is no status row. |
| 59 | After leaving the code step and pressing Back, no input holds the code or the new password, whichever state the browser restores. A code typed as "123 456" is sent as six digits and resets. |

## Running

```bash
npm run test:browser -- --grep @t05-T5
npm run test:browser -- --grep @t05-verify
npx playwright test --project chrome --grep E2E-05-48
```

Run one browser run at a time, because the ports are fixed.

## Status

Written test-first on 2026-10-16. They type-check, lint, and are listed under every tag. They have not run: the pages and the API do not exist yet. T5's gate is these tests passing.
