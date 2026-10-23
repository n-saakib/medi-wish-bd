# `tests/browser/recoveryApi.spec.ts`

Source: [`../../../tests/browser/recoveryApi.spec.ts`](../../../tests/browser/recoveryApi.spec.ts)

## Purpose

These are the Ticket 05 API acceptance tests, E2E-05-01 to E2E-05-36 (plan §10.4). Tests 32 to 36 cover service rules of plan §4.3 that the original table left out. They call the real test API with Playwright's `request` fixture and with `ApiSession` clients from [`apiSession.ts`](apiSession.ts.md), and read codes from the run's mail capture directory through [`recoverySupport.ts`](recoverySupport.ts.md). Each test runs on the `chrome` and `msedge` projects. All data is synthetic.

They were written test-first on 2026-10-16, before any Ticket 05 backend code, and fail until T4 wires the T2 and T3 rules to the API. Every test is tagged `@t05` and `@t05-T4`, plus one area tag for focused runs during development:

| Area tag | Tests |
| --- | --- |
| `@t05-reset` | 01–09, 11–16, 29, 32–34, 36: the public reset routes |
| `@t05-limits` | 10, 20, 26: the issue, address and current-password limits |
| `@t05-verify` | 17–19, 21, 35: the email verification routes |
| `@t05-email-change` | 22–25, 27, 31: the current-password rule and its effects on `PUT /profile` |
| `@t05-authz` | 28: actors, public routes and CORS |
| `@t05-privacy` | 30: R1 log, response and table checks |

## Local helpers

- **Profile:**
  - `expectRecoveryProfile` checks the full Ticket 05 `Profile` key list, including `emailVerified`. It is listed in full, so a change to the Ticket 11 list cannot hide a missing key.
  - `readProfile`, `profileBody` and `saveProfile` build a `PUT` from the current fields. An `undefined` key, such as a missing `currentPassword`, is left out of the JSON.
- **Verification and reset:**
  - `requestVerification` and `confirmVerification` call the verification routes.
  - `verificationCode` and `resetCode` return the newly mailed code.
  - `settledMail` counts messages after a sentinel.
- **Sessions:**
  - `signedIn` opens one session per request context.
  - `tracked` registers staff sessions.
  - The `afterEach` disposes every session a test opened.
- **SQL probes:**
  - `markEmailUnverified` lets one User hold codes of both purposes.
  - `storedCodeIds` reads only row UUIDs to prove a newer request replaced the prior code row, even when two random six-digit values collide, and to check that limited requests retain the live row. A successful confirm checks that the last mailed code remains usable after a limit refusal.
  - `codeRowFingerprint` compares a digest of the complete live code row across a 60-second-gap refusal. It catches in-place changes to the code hash or failed-attempt count without exposing either value.
  - `codeHashesWellFormed` checks each code is a 64-character hex HMAC.
  - `staffMfaFingerprint` holds row counts and md5s of the factor and backup-code rows, so no secret reaches the output.
  - `isSuperAdmin` checks the Super Admin.
- **Bodies:** `paddedJson` builds a valid body of an exact size, against the 16 KiB limit. Empty-body and privacy checks compare lengths or booleans so a failed check does not dump a raw response, captured mail, or API log. Other contract matchers may still show their synthetic fixtures in normal Playwright diagnostics.

## Tests

| ID | Checks |
| --- | --- |
| 01 | Verified, unverified, unknown, and padded upper-case addresses get the same `202`: same status, empty body, same headers apart from `X-Request-ID` and `Date`. Mail goes only to the verified ones, at the stored address. There is no code row or `PASSWORD_RESET_REQUESTED` audit for the unverified User. |
| 02 | A full reset with an upper-case address gives `204` with no cookie. The old password gets `401`. The earlier session's access and refresh tokens are refused (`password-reset`). The new password signs in by username and email. No codes are left, and the audit is in order. |
| 03 | A used code replays as `CODE_INVALID`, and the password stays as reset. |
| 04 | An expired code gets `CODE_INVALID`. Its row is removed and the password is unchanged. |
| 05 | Four wrong codes count 1–4; the fifth deletes the code; the right code then gets `CODE_INVALID`. The audit has four `ACCOUNT_CODE_FAILED` and one `ACCOUNT_CODE_LOCKED`. |
| 06 | A newer request replaces the older row (UUID changes, one live row); when the random digits differ, the older code is refused. The newer code resets. |
| 07 | Verification and reset have separate live purpose rows. When their random digits differ, each code fails on the other route and counts one try; each code then works for its own purpose. Equal digits cannot distinguish the source purpose. |
| 08 | Both accounts have their own code rows. When their random digits differ, each code fails on the other's address; an unknown address always fails. Both passwords remain unchanged until each code is used for its own account. Equal digits cannot distinguish the source account. |
| 09 | Passwords of 5 or 31 characters, empty, blank, and `null`, number, boolean, array or object values get `400 INVALID_REQUEST` and use no try. `" abc123 "` is stored exactly as typed. 6 and 30 characters are accepted. |
| 10 | The sixth code in an hour sends nothing, counting a verification code. So does a request inside the 60-second gap. The gap leaves the complete live reset-code row unchanged; the hourly refusal keeps its row, and the last mailed code still resets. The eleventh request for one address in an hour sends nothing, in any letter case, while the tenth for a control address still mails. The eleventh request keeps its live row and the first mailed code still resets. Every request answer is `202`. |
| 11 | Wrong keys, wrong types, malformed or 321-character emails, invalid code formats, broken JSON, `text/plain` and 16 KiB + 1 get `400 INVALID_REQUEST` on both routes. Invalid code formats include space-padded, split, full-width and Arabic-Indic digits. Errors never echo the address, and none uses a try. Exactly 16 KiB is read. |
| 12 | An MFA-verified Admin resets. The verified session is revoked and the factor and backup codes are untouched. The next sign-in is `VERIFICATION_REQUIRED` (`/api/staff/me` is `403 MFA_REQUIRED`) until a TOTP code is entered. |
| 13 | The Super Admin resets, stays Super Admin, and keeps the authenticator. |
| 14 | A closing account resets, its earlier session is revoked, and it stays `CLOSURE_REQUESTED`; a name edit gets `409 ACCOUNT_CLOSING`. |
| 15 | The code mail holds one code, mentions 15 minutes (checked with the code taken out), and has no link or password. Exactly one password-changed notice is sent, with no code, password or link. |
| 16 | Unverified, unknown and closing-but-unverified addresses get no mail, no code row and `CODE_INVALID` on confirm. |
| 17 | Verification gives `204` (any body is ignored), a mailed code that mentions 15 minutes and holds no link or password, and `200` with `emailVerified: true` at the same version. A repeat confirm is idempotent. The address then receives reset codes. |
| 18 | Malformed codes, extra keys, broken JSON, `text/plain` and 16 KiB + 1 use no try. Wrong codes count, five void the code, and a new code then verifies. |
| 19 | With no saved email, both routes get `409 EMAIL_REQUIRED`. For an already verified email, a request gets `204`, sends nothing and issues nothing (an immediate reset still mails), and a confirm returns the verified profile. |
| 20 | Verification and reset codes share one limit. An immediate verification refusal within the 60-second gap leaves the complete live verification-code row unchanged; after a reset issue, the same cross-purpose refusal leaves the complete live reset-code row unchanged. Three verification and two reset codes fill the hour: the next verification request gets `429 TOO_MANY_ATTEMPTS` and the next reset sends nothing while keeping the live reset-code row. The last mailed reset code still works, and a new hour issues again. |
| 21 | A closing account gets `409 ACCOUNT_CLOSING` on both verification routes, even with a code issued before closing. |
| 22 | Shape checks (`400 INVALID_REQUEST`) come first and are not counted. A missing, `null`, blank or wrong password gets `400 CURRENT_PASSWORD_INVALID` and changes nothing. The right password gives `200` with `emailVerified: false` and version + 1. The audit has `CURRENT_PASSWORD_FAILED` ×4 and `EMAIL_CHANGED`. |
| 23 | An email change deletes both outstanding codes; the old codes then fail. The new address verifies with a new code. |
| 24 | The old address gets one `EMAIL_CHANGED` notice, with no code, password or link, only when it was verified. |
| 25 | Clearing the email needs the password. Afterwards the old address gets no reset code, verification gets `409 EMAIL_REQUIRED`, and setting an email again needs the password. |
| 26 | Five wrong passwords make the right one `429`. Name edits still work, and an aged window clears the limit. Four wrong passwords and then the right one start the count again. |
| 27 | Name and date edits ignore a wrong `currentPassword` and never count it. The same email in any case is a no-op. The order holds: state → validation → version → password → uniqueness (`DUPLICATE_USER` only with the right password). |
| 28 | Verification routes give `401` (with `WWW-Authenticate: Bearer`) to anonymous callers and invalid tokens. Restricted staff in both MFA phases get `403 MFA_REQUIRED`, with no mail sent. A Delivery Person, a verified Moderator and a verified Admin verify. The reset routes ignore any token. Preflights to all four routes allow `POST` from the storefront only. |
| 29 | Two concurrent confirms of one code give one `204` and one `CODE_INVALID`. Only the winner's password signs in. |
| 30 | R1: registration without an email gives `201` and a profile with no email. A recovery flow, including a second valid reset request after confirmation, rewrites only the recovery tables. Public answers hold no code, password or address, and signed-in answers hold no code or password. The API log holds no password, no captured address, and no captured code. The code scan masks recognized ISO timestamps and UUIDs before matching digit boundaries, including punctuation-delimited leaks. Privacy assertions report booleans instead of raw body or log content. |
| 31 | O8: a refused change, a name save, a no-op and verification revoke nothing. An email change or clearing revokes every other session (`email-changed`, access and refresh refused) and keeps the current one. |
| 32 | Reset eligibility needs a usable password verifier: an unusable one gets the same `202` and no mail or code, and a code issued before the verifier became unusable gets `CODE_INVALID` with no notice. |
| 33 | Eligibility is checked again at confirm: an email unverified after the code was sent gets `CODE_INVALID`, the password is unchanged, and a new request sends nothing. |
| 34 | A code is bound to the address it was sent to. After the saved email changes outside the profile route, the old address finds no User and the new one finds a stale code, which is removed; the same holds for verification. A code sent to the saved address then works, and the notice goes only there. |
| 35 | An expired verification code gets `CODE_INVALID`, its row is removed and the email stays unverified until a new code verifies it. |
| 36 | A reset changes only the password: the profile, its version and the verified mark stay, and codes of both purposes are removed. |

## Running

```bash
npm run test:browser -- --grep @t05-T4
npm run test:browser -- --grep @t05-limits
npx playwright test --project chrome --grep E2E-05-22
```

`--grep @t05` runs the whole ticket, and an area tag runs one slice. Run one browser run at a time, because the ports are fixed.

## Status

Written test-first on 2026-10-16. They type-check, lint, and are listed under every tag. They have not run: no Ticket 05 backend exists yet, so they are expected to fail at the first new route, column or mail. T4's gate is these tests passing.

E2E-05-01 checks the uniform response bytes and mail eligibility. Plan T7 separately requires controlled proof that the request path does no mail I/O or password encoding, plus 50-request timing samples and statement-count evidence. This browser spec does not use wall-clock timing as an acceptance oracle.
