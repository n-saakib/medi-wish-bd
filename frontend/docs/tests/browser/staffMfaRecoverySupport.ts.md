# `tests/browser/staffMfaRecoverySupport.ts`

Source: [`../../../tests/browser/staffMfaRecoverySupport.ts`](../../../tests/browser/staffMfaRecoverySupport.ts)

## Purpose

Helpers shared by the Ticket 09 specs (replace a lost staff authenticator using a backup code); this file is not a spec. They assert the contract of the Ticket 09 plan §4 and the frozen API in `09.T1-contract-evidence.md`. Every helper works on synthetic Users the calling test registers itself, so one test's shared throttle (5 failures, then a 15-minute lock) never reaches another.

## Contract values

- `backupCodeAlphabet` and `backupCodePattern`: D4's codes, `XXXX-XXXX` without the look-alikes `I L O U 0 1`.
- `copy`: the page strings the specs rely on (plan §4.6 and §10.3), with typographic apostrophes and ellipses. `accessDenied` is the alert shown after a 403 from the verify route; E2E-09-05b waits for it through `alertWith` because the route announcer also has the `alert` role.
- `ContactNotice` and `noticeText`: the four `contactNotice` values and the panel line each shows.
- `sessionFields`, `firstEnrollmentFields`, `replacementFields`, `enrollmentStartFields` and `userProfileFields`: the exact key sets of the response bodies; an extra key fails the specs. A first enrollment has no `contactNotice`.
- `replacementLifetimeSeconds` (600): the replacement session's fixed lifetime (P9).
- `wrongBackupCode(known)`, `wrongTotp(authenticator)` and `typedLoosely(code)`: a well-formed wrong code (refused as wrong, not malformed), a 6-digit code that is not the current, previous or next step's, and a code typed in lower case with a space for the separator.

## Pages

- `recoveringStaff(page, kind, { verifiedMobile })` registers a User through the API, verifies their mobile (unless `false`), gives them `MODERATOR`, `ADMIN` or the Super Admin with SQL, signs in, enrolls through the pages, reads the 10 codes and saves them; the page ends on `/staff`.
- `backupDialog`, `openBackupDialog`, `submitBackupCode` and `submitBackupCodeAndWait` (which returns the `/recovery` status), `redeemBackupCode` (to the replacement setup page) and `signInToChallenge`.
- `verifySetupKey(page, key)` verifies a key already read with `readManualKey`, which leaves `Can’t scan?` open.
- `finishReplacement(page, notice)` verifies the new key, expects the notice line and returns the new authenticator and codes; `replaceThroughPages` runs the whole recovery to `/staff`.
- `signOutFromStaff`, `alertWith`, `readStorage` (local and session storage, history state, URL and all browser cookie values, including HttpOnly; it fails if any IndexedDB database or CacheStorage cache exists on the app origin), `recordSurfaces` (requested and navigated URLs in raw and decoded form, console text and serializable console arguments, page errors and request bodies) and `countRequests(page, path)`. Await `recordSurfaces(...).flushConsole()` after browser actions and before checking `consoleText`; capture errors reject the flush. Only POST submissions to the actual API origin and designated credential routes are excluded from body capture; sending their secrets to those endpoints is authorized. Opaque refresh cookies are allowed; the specs look for known codes, keys, passwords and contacts in cookie values.

## API

- `apiRecoveryStaff(request, kind, { verifiedMobile })`: the same User over the API, enrolled with its 10 codes kept (`RecoveryActor`); `enrollKeepingCodes` and `adopt` support it.
- `passwordSession(actor)`: a new password sign-in, which must be `VERIFICATION_REQUIRED`.
- `redeem`, `startEnrollment`, `startedEnrollment` (expects `201`, the exact key set and `Cache-Control: no-store`), `verifyEnrollment` (checks `no-store` on `200`), `regenerate` and `verifyChallenge` call the four MFA routes. They allow `ApiSession` to refresh near-expired tokens; `redeem`, `startEnrollment` and `verifyEnrollment` accept an explicit token for stale-token assertions. A `200` session body replaces the `ApiSession`'s token and status. `enrollKeepingCodes` also checks `no-store` on both first-enrollment success responses.
- `sendRaw(session, path, body, contentType)` sends any body for the strict-body tests.
- `replaceThroughApi(session, code)` runs the whole recovery and returns the new authenticator, codes, `contactNotice` and body.
- `refreshCookieMaxAge(response)` reads the `MW_REFRESH` cookie's `Max-Age`.

## Database probes

Each checks the run's schema and the synthetic username with `checkedTarget` first.

- Read: `factorRows` (status, revoked, activated, unused and used codes, oldest first), `factorStatuses`, `sessionRows` (state or revocation reason, factor, replacing factor, verified, lifetime and expiry), `activeSessions`, `auditTypes`, `auditCount`, `auditText`, `throttleState`, `consumedSessionIds` and `roleOf`.
- Write: `expireReplacementSessions` moves a User's active replacement sessions past their expiry, and `revokeActiveFactorLikeTicket10` revokes the active factor as a Ticket 10 reset would.

Codes, keys and tokens are held in memory only; nothing is logged.

The integrated replacement notice contract uses verified-contacts wording for `SENT` and `FAILED`, covering mobile and email without disclosing recipients; the other two outcome messages remain unchanged.
