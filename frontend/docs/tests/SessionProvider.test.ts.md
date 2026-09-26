# `tests/SessionProvider.test.ts`

Source: [`tests/SessionProvider.test.ts`](../../tests/SessionProvider.test.ts)

## Purpose

Unit coverage for [`SessionProvider`](../src/auth/SessionProvider.tsx.md), its reducer and the pure [`sessionRedirect`](../src/auth/sessionRedirect.ts.md) rules. It runs under jsdom with a probe component mounted through [`renderWithSession`](renderWithSession.ts.md) and an injected session source.

## Verification

- **Restore:** a restored profile is shared; an empty restore stays quietly signed out; `sessionExpired` is reported only when an in-memory session existed; a restore failure sets `restoreError` without exposing its detail.
- **Actions:** sign-in shares the profile and clears an earlier notice; a failed sign-in is rethrown and leaves the user signed out; sign-out records `signedOut`; a failed sign-out still ends the local session and records `signOutError`.
- **Reducer guards:** a restore error arriving during a pending sign-in, or after a successful one, does not produce a stale notice.
- **Notice lifetime:** a notice survives arrival on its own page (`signedOut` on `/`, `accountCreated` on `/sign-in`) and is dropped on any other page; after that, `/account` sends a signed-out visitor to sign-in rather than home.
- **Redirect rules:** no redirect while restoring; the account guard sends signed-out visitors to `/sign-in`, stays while signed in or signing out, and goes to `/` after either sign-out result; the guest guard sends signed-in users to `/account`.

On 2026-09-26 this suite passed as part of `npm run test:unit` (8 files, 92 tests).
