# `tests/browser/journey.spec.ts`

Source: [`../../../tests/browser/journey.spec.ts`](../../../tests/browser/journey.spec.ts)

## Purpose

This is the Ticket 03.02 T5 journey, run once on each channel. It closes Ticket 02.T5 (a real browser registration and sign-in) and Ticket 03 AC6 (the refresh-and-retry demonstration). Each step asserts its complete console errors and API responses through `watchPage`.

## Steps

0. Positive control: an unauthenticated `fetch` of `/api/user/me` produces the 401 console line, which proves the listener catches such lines.
1. Registration signs in, and `/account` shows the username, mobile and email loaded by `GET /api/user/me` (steps 1 and 2).
2. A reload restores the session through CSRF and refresh (step 3).
3. From home, after the 10-second access lifetime plus 2 seconds, the header link to `/account` produces exactly `401 GET /api/user/me`, one CSRF, one refresh and `200 GET /api/user/me` (step 4).
4. Sign-out returns home, and the focused status announces it (step 5).
5. A signed-out reload is quiet: the refresh returns `204` and nothing logs a console error or returns 400 or higher (step 6).
6. A wrong password shows the generic alert and refocuses the identifier (step 7).
7. The correct password opens `/account` (step 8).
8. A separate API client refreshes with the browser's cookie, from `context.cookies()` for the cookie's `/api/auth` path. The browser's next load therefore replays a consumed cookie: `/sign-in` shows the focused session-expired notice after one `401` refresh, and the next reload is quiet (step 9).
9. A guest opening `/account` is sent to `/sign-in` (step 10).

The only console errors allowed are the three expected 401 lines (steps 4, 7 and 9) and the positive control.
