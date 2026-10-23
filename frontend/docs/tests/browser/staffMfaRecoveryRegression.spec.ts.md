# `tests/browser/staffMfaRecoveryRegression.spec.ts`

Source: [`../../../tests/browser/staffMfaRecoveryRegression.spec.ts`](../../../tests/browser/staffMfaRecoveryRegression.spec.ts)

## Purpose

Ticket 09's browser regressions: codes shown once, roles never restored by recovery, the notice line, an unchanged first enrollment and no secret on any browser or server surface (plan §10.2, T6). Tag `@t09-T6` with `@regression` (and `@security` or `@cross-06-09`). Written before the feature; the tests fail until it is delivered.

## Tests

- **E2E-09-04:** after a replacement, back, forward, reload and reopening the setup never retain the codes in DOM text (including hidden text) or live form values, each navigation waits for network idle so the restored session settles before the next one (an aborted refresh reads as a replay and ends the session), and the DOM is then checked at once, so a page restored from the back-forward cache counts; storage is checked while codes are shown and after leaving, and URLs and serialized console arguments hold no code or key; `/staff/mfa/enroll`, `/staff/backup-codes` and `/staff/mfa` are served with `no-store`.
- **E2E-09-05:** a Moderator demoted to Customer by the Super Admin (Ticket 08 API) during recovery lands on `/sign-in` when verifying the new key, never on `/staff`; signing in again opens `/account`.
- **E2E-09-05b:** the same with the role removed in SQL: the browser waits for the verify request's 403 response and the "You don’t have permission to do that." alert before reloading to `/account`, and no factor is replaced.
- **E2E-09-08:** without a verified mobile the panel says "No verified contact to notify." and nothing else.
- **E2E-09-17:** while regenerated codes are shown, navigation to `/staff` followed by Back and Forward must not retain them in DOM text or live form values; reloading the returned regeneration page must not retain them either. Each navigation waits for network idle, as in E2E-09-04. Storage is checked while shown and after navigation, and URLs hold no code.
- **E2E-09-18:** a first enrollment shows "Set up your authenticator" and its codes without any notice line.
- **E2E-09-19:** across a wrong code, a recovery and a regeneration, no code, key, password or contact reaches a URL, serialized console arguments, browser storage (while shown, after leaving and after reload), non-auth request bodies or page errors. Pending console captures are drained before inspection. The current journey's API log and audit rows omit those values and the username; the actual submitted replacement and regeneration TOTP values are checked there as bounded six-digit tokens. Authorized authentication request bodies are excluded from the request-body scan.

## Running

`npm run test:browser -- --grep "@t09-T6" --project chrome`, never beside another browser run.
