# `tests/browser/profileApi.spec.ts`

Source: [`../../../tests/browser/profileApi.spec.ts`](../../../tests/browser/profileApi.spec.ts)

## Purpose

The Ticket 11 API acceptance tests, E2E-11-01 to E2E-11-32 and E2E-11-49 to E2E-11-51. They call the real test API with Playwright's `request` fixture: `GET` and `PUT /api/user/me/profile`, and `POST` and `DELETE /api/user/me/mobile-change`. Each test runs on the `chrome` and `msedge` projects.

Each is tagged `@t11` and `@t11-T4`: they first pass when sub-ticket T4 (the profile API over the T2 schema) is complete. E2E-11-50 is tagged `@t11-T2` instead: it uses only the existing registration route with the T2 identifier formats (plan P12). The tests read and set the stored state through the guarded SQL helpers in [`testApi.ts`](testApi.ts.md) (`storedProfile`, `setAccountState`, `markMobileVerified`, `grantRole` and `tableFingerprints`). `grantRole` makes the given role the User's only role (DECISIONS S6: one role per User, each role inheriting the permissions of the roles below it), and the spec's own `storedRoles` reads it back. The spec's `enrollStaff(staff)` enrolls an authenticator using the staff client's renewed headers and existing request context. `verifiedStaff(role)` registers and enrolls a staff member in a request context of their own and returns a `ProfileApi.onSession` client, which refreshes the MFA-verified session as its 10-second token ages (the context keeps that session's refresh cookie, so no other sign-in replaces it; tests 29, 30 and 49 dispose their contexts), and `expectNoForeignProfile` sends the id- and name-carrying probes of 28 and 49. The HTTP helpers come from [`profileSupport.ts`](profileSupport.ts.md); every error answer goes through its `expectError`, which also checks `no-store` and that `requestId` is non-empty and equals `X-Request-ID`. The spec's `emailOfLength` builds an accepted email of an exact length, and `postRegistration` sends a registration unchecked. `paddedJson(value, bytes)` serializes a valid body to exactly `bytes` bytes by adding JSON white space after the opening brace, against `bodyLimit` (16 KiB, the backend's `AuthRequestBodyLimitFilter`); test 10 uses it because the body limit and validation both answer `400 INVALID_REQUEST`. All data is synthetic.

## Tests

| ID | Checks |
| --- | --- |
| 01 | A new User reads the profile at version 0 with exactly the contract keys and `no-store`; `/api/user/me` keeps its four keys. |
| 02 | Saving normalizes the full name and the email, stores them and bumps the version once; a GET returns the same. |
| 03 | `null` or blank values clear the optional fields. |
| 04 | A changed email signs in, even in another letter case; the old email gets `401 AUTHENTICATION_FAILED`. |
| 05 | Full name: the 100 UTF-16 unit limit is checked after trimming and before collapsing internal ASCII spaces. `A` + 98 spaces + `B` is accepted as `A B`; 99 or 100 internal spaces get `400` without any stored profile change. 100-character text and Bangla text are accepted; 101-character text, control characters and line breaks get `400`. |
| 06 | Email, the P12 subset: 254 characters in total, a 64-character local part, the `atext` specials, a dotted local part and a 63-character label are accepted and lower-cased. 255 characters, a 65-character local part, a 64-character label, a missing or doubled `@`, a space, an empty part, a single-label domain, an IP literal, a quoted local part, a comment, doubled or edge dots, edge hyphens, a trailing dot and non-ASCII get `400`. |
| 07 | Date of birth: `1900-01-01`, today in Dhaka, `2000-02-29` and `null` are accepted. An earlier date, tomorrow in Dhaka, a non-ISO or impossible date, a word and a number get `400`. |
| 08 | The body needs all four keys and a version that is a JSON integer of 0 or more: `-1`, `null`, `1.5`, `"0"`, `true` and `false` get `400`, and so does a number or boolean full name or email (no coercion). An optional currentPassword is accepted as string/null and rejected for coercion or more than 128 characters; the four original fields remain required. Unknown properties, including emailVerified, are refused. A valid control save then succeeds. |
| 09 | The username cannot be changed, and a mass-assignment body changes nothing. |
| 10 | Valid JSON padded with white space to one byte over 16 KiB, `text/plain`, broken JSON, arrays and empty bodies are refused on `PUT` and `POST`, and nothing is stored. The same valid bodies padded to exactly 16 KiB are then accepted (`200` and `202`), so the oversized refusals come from the body limit alone. |
| 11 | An email another User holds, in any letter case, gets `409 DUPLICATE_USER` with the generic message. The User's own email in upper case is a no-op. |
| 12 | A stale version gets `409 STALE_UPDATE` with the exact message, and stores nothing. Staging a mobile does not need the version (P5). |
| 13 | An identical save at an old version, as after a lost response, is a no-op, also when it matches only after normalization; a different value at the old version gets `409 STALE_UPDATE` (plan §4.1 order: validation, no-op, version). |
| 14 | Two concurrent different saves from one version get `200` and `409 STALE_UPDATE`. An outcome check only; the backend `ConcurrentProfileIT` proves the paths deterministically. |
| 15 | Two concurrent identical saves both get `200`, with one version bump (outcome check). |
| 16 | Two Users racing to the same new email get `200` and `409 DUPLICATE_USER` (outcome check; the `23505` fallback is proven in `ConcurrentProfileIT`). |
| 17 | A staged mobile answers `202` with `pendingMobile`. The current mobile, `/api/user/me` and the version stay unchanged. |
| 18 | While a change is pending, the current verified mobile signs in and the pending one gets `401`. |
| 19 | A new mobile keeps the registration format: exactly 11 ASCII digits after trimming, and different from the current one. 10 or 12 digits, `+88…`, a letter, a hyphen or space inside, Bangla or full-width digits, a JSON number or boolean, a missing or `null` mobile and extra keys get `400`. |
| 20 | A mobile that another User holds gets `409 DUPLICATE_USER`. |
| 21 | A pending number reserves nothing: two Users can stage it, and a new User can register it. After that, staging it gets `409`, while the earlier pending changes stay. |
| 22 | A newer stage replaces the pending change with a new row, even for the same number. |
| 23 | Cancelling answers `204` with an empty body, and a repeat still answers `204`. |
| 24 | Two concurrent stages leave exactly one pending row (outcome check). |
| 25 | No HTTP route verifies or applies a staged mobile. Seven guessed routes each answer only a status that shows no handler ran, with its error envelope: `401 AUTHENTICATION_REQUIRED` or `403 ACCESS_DENIED` (the deny-all rule) or `404 NOT_FOUND` or `405 METHOD_NOT_ALLOWED`; a `400`, `409`, `415` or `5xx` fails the test. Nothing changes. The backend route inventory in `UserProfileIT` (plan T5) proves that no such mapping exists. |
| 26 | A closing account reads `200` with `CLOSURE_REQUESTED`. Every edit, stage and cancel then gets `409 ACCOUNT_CLOSING` with the exact message, whether it is current, stale, identical or invalid, and the database is unchanged. The same edit succeeds once the account is `ACTIVE` again. |
| 27 | A missing, malformed or revoked (signed-out) token gets `401 AUTHENTICATION_REQUIRED` with `WWW-Authenticate: Bearer` on every route. |
| 28 | Another User's token neither reads nor changes the victim's profile. No victim value appears in any answer, and the victim's row is unchanged. |
| 29 | Sole-role Admin and Moderator sessions in both `ENROLLMENT_REQUIRED` and `VERIFICATION_REQUIRED` (authenticator challenge required after enrollment and a new sign-in) get `403 MFA_REQUIRED` on all four routes. Each has its own renewable session context; neither denial phase changes the stored profile. |
| 30 | A DeliveryPerson, an MFA-verified Admin and an MFA-verified Moderator, each holding only that role and no `CUSTOMER` role, read, edit, stage and cancel on their own profile. The verified staff use separate renewable session contexts. |
| 31 | CORS preflights for GET, PUT, POST and DELETE from `http://127.0.0.1:3100` answer `200` with the origin and method allowed. Another origin gets `403`. |
| 32 | R1: after each edit, stage and cancel, every table outside `profileWritableTables` keeps its fingerprint, and the username never changes. |
| 49 | An MFA-verified Moderator and Admin, each holding only that role, save their own profile. Their tokens, sent to routes or queries naming a Customer's id or username, never return or change the Customer's profile. |
| 50 | `@t11-T2`. Registration applies the identifier formats: a 20-character username is accepted and signs in. A 21-character username, one with `@`, a digits-only one, a 10- or 12-digit or non-digit mobile, and an email over 254 characters, with a 65-character local part, doubled dots, a quoted local part, an IP literal or a single-label domain get `400`, and nothing signs in. |
| 51 | No identifier can take another kind's value: another User's username or email as a mobile (staged or registered), their mobile or email as a username, and their username or mobile as an email (saved or registered) all get `400`, a format refusal rather than a duplicate check. The other User's identifiers still sign in only that User. |

## Running

```bash
npm run test:browser -- --grep @t11-T4
npm run test:browser -- --grep @t11-T2
```

Run only one browser suite at a time on a machine, because the ports are fixed.

## Not covered here

- `MobileChangeService.activate`: it has no HTTP route, so the backend ITs cover it.
- Persistence across a backend restart: `UserProfileIT` covers it.

Ticket 05 keeps the four required edit keys and tests optional string/null currentPassword shape. Owner-aware successful fixtures preserve current email and prove password-protected changes, while authorization, malformed, stale and closing payloads remain raw. Profile projections gain emailVerified; /api/user/me retains its existing four keys. Mass assignment cannot set emailVerified.
