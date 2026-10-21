# `tests/browser/profileSupport.ts`

Source: [`../../../tests/browser/profileSupport.ts`](../../../tests/browser/profileSupport.ts)

## Purpose

Shared helpers for the Ticket 11 specs, [`profileApi.spec.ts`](profileApi.spec.ts.md) and [`profile.spec.ts`](profile.spec.ts.md). It is not a spec. Its data is synthetic, and it never prints a profile value.

## Exports

- **`copy`** — the Ticket 11 contract strings, fixed in plan §10. The API and the page must match them exactly:
  - `staleApi` and `staleUpdate`: `This record changed after you opened it. Reload and try again.`
  - `closingApi`: `This account is closing, so it can't be changed.`
  - `accountClosing`: `Your account is closing.`
  - `duplicateUser`: the shared `errors.duplicateUser` text.
  - `checkDetails`: `Check your details and try again.`
  - `profileSaved`: `Profile saved.`
  - the three field errors: `fullNameInvalid`, `emailInvalid` and `dateOfBirthInvalid`.
  - `mobileExplanation`, the dialog's explanation.
  - `pendingNote(mobile)`: `New number <mobile> is waiting for verification.`
- **`profilePath`** (`/api/user/me/profile`) and **`mobileChangePath`** (`/api/user/me/mobile-change`).
- **`Profile`** and **`profileKeys`** — the plan §4.2 body, and its exact sorted key list.
- **`profileWritableTables`** — the only tables a profile or mobile edit may write (plan T6 R1).
- **`syntheticMobile()`** returns `018` and 8 random digits (11 digits, plan P12). **`syntheticDigits(length)`** returns `01` and random digits up to `length`, for mobile format checks. **`syntheticFullName()`** returns a name that is easy to find in a scan.
- **`dhakaDate(days, from)`** gives the `yyyy-MM-dd` date in Asia/Dhaka. **`awayFromDhakaMidnight(page?)`** waits past Dhaka midnight when it is under 20 seconds away, so a "today" and "tomorrow" pair stays valid.
- **`registerByApi(api, customer?)`** registers a User through the API. **`signInByApi(api, identifier, password)`** signs one in.
- **`ProfileApi`** — the profile routes for one User over a Playwright `APIRequestContext`:
  - Clients are made by `register`, `forUser` (an existing password User) and `onSession(api, customer, {accessToken, mfa})` (an existing session, such as an MFA-verified staff session; `api` must be that User's own request context, because it holds the session's refresh cookie).
  - The Bearer token is renewed once half of the 10-second test access token is spent. A password User signs in again. A session client calls `GET /api/auth/csrf` and then `POST /api/auth/refresh` with `X-XSRF-TOKEN`; the backend rotates the refresh token of the same session, so the MFA verification is kept, and the client checks that the answer names the same User with an unchanged `mfa` status. Concurrent calls share one renewal, because a replayed refresh cookie revokes the session.
  - **`MfaStatus`** is the `mfa` value of a session answer, including Ticket 09's `REPLACEMENT_REQUIRED`.
  - `get`, `put(body, contentType)` and `stage(body, contentType)` send an object as JSON and a string as the raw body. `cancel` sends a DELETE.
  - `profile()` reads the profile and checks it. `save(edit)` puts the current values with the edit at the current version.
- **`expectNoStore(response)`** checks for the `no-store` directive.
- **`expectProfile(response, 200 | 202)`** checks the status, `no-store` and the exact profile keys.
- **`expectError(response, status, code, message?)`** checks the bounded envelope: exactly `code`, `message` and `requestId`, with `no-store`, and a non-empty `requestId` equal to the `X-Request-ID` header.
- **`openProfile(page, customer)`** signs in through the form, waits for `/account`, then opens `/account/profile` and waits for the `Profile` heading and the `Full name` field.
- **`recordProfileCalls(page)`** collects each real call a page makes to the two profile routes: `method`, `path`, `status` and the request `body`. It skips CORS preflights, and it skips the `401` that the session client refreshes and retries once.
- **`recordProfileRequests(page)`** collects every request (`METHOD path`) the page sends to the profile routes, whatever the answer, including a `401` or no answer; CORS preflights are skipped.
- **`urlScanText(url)`** returns a URL with its decoded forms (the whole URL, path, query names and values, fragment; `+` read as a space) for privacy scans. **`encodedForms(value)`** returns a value as typed, percent-encoded and form-encoded (`+` for a space).

## Database state helpers

These read or change the columns and table Ticket 11 adds, so they live here rather than in `testApi.ts`; they use `psql` and `checkedTarget` from there, with the same schema and synthetic-username guards. Each throws when no User matches.

- **`setAccountState(username, 'ACTIVE' | 'CLOSURE_REQUESTED')`** sets `users.account_state`. The closure tickets (46/47) will own this change; Ticket 11 has no route for it.
- **`storedProfile(username)`** returns the User's id, username, profile columns, mobile, `mobile_verified`, `profile_version`, `account_state`, and every `user_mobile_changes` row (`id`, `newMobile`), read straight from the database.
