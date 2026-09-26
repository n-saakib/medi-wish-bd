# `tests/SessionProvider.test.ts`

Source: [`tests/SessionProvider.test.ts`](../../tests/SessionProvider.test.ts)

## Purpose

Unit coverage for [`SessionProvider`](../src/auth/SessionProvider.tsx.md), its reducer and the pure [`sessionRedirect`](../src/auth/sessionRedirect.ts.md) rules. It runs under jsdom with a probe component mounted through [`renderWithSession`](renderWithSession.ts.md) and an injected session source, or a real session client over the [`fakeApi`](fakeApi.ts.md) routes. [`installFakeLocks`](fakeApi.ts.md) gives the real session client the cross-tab lock of a secure context, which jsdom lacks.

## Verification

- **Restore:** a restored profile is shared; an empty restore stays quietly signed out; a real client whose refresh answers `401` sets `sessionExpired`; an unexpected error or a non-401 `ApiError` sets `restoreError` without exposing its detail.
- **Actions:** sign-in shares the profile and clears an earlier `sessionExpired` notice from a restore `401`; a failed sign-in is rethrown and leaves the user signed out; sign-out records `signedOut`; a failed sign-out still ends the local session and records `signOutError`; a protected request rejected with `401` is rethrown and ends the session with `sessionExpired`, while another failure is rethrown and keeps the profile. With a real client, a profile request held across sign-out, and across sign-out then sign-in, is released with a `200`: it is rejected, but the provider keeps `signedOut` or the newer profile instead of setting `sessionExpired`. A profile request held across a failed sign-in that then gets a `401`, after a refresh that also fails, still ends the session with `sessionExpired`.
- **Reducer guards:** a restore error arriving during a pending sign-in, or after a successful one, does not produce a stale notice.
- **Notice lifetime:** a notice survives arrival on its own page (`signedOut` on `/`, `accountCreated` on `/sign-in`) and is dropped on any other page; after that, `/account` sends a signed-out visitor to sign-in rather than home.
- **Redirect rules:** no redirect while restoring; the account guard sends signed-out visitors to `/sign-in`, stays while signed in or signing out, and goes to `/` after either sign-out result; the guest guard sends signed-in users to `/account`.

On 2026-09-26 this suite passed as part of `npm run test:unit`.
