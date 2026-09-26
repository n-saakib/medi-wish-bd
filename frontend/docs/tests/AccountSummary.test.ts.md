# `tests/AccountSummary.test.ts`

Source: [`tests/AccountSummary.test.ts`](../../tests/AccountSummary.test.ts)

## Purpose

Mounted jsdom coverage for [`AccountSummary`](../src/account/AccountSummary.tsx.md) and [`SignOutNotice`](../src/auth/SignOutNotice.tsx.md) through [`renderWithSession`](renderWithSession.ts.md), with `next/navigation` mocked (router plus a fixed `/account` pathname). The sign-out cases mount both components under one provider, as the root layout shares one provider between the account and home pages.

## Verification

- A restored profile shows `Your account` with username and mobile, omits the email row when there is no email, and does not redirect; an email is shown when present.
- While the restore is held open, a `Checking your session…` status is shown without redirecting; an empty restore then removes the content and redirects to `/sign-in`.
- Sign-out disables the button with `Signing out…` and stays on the page while pending; on success it redirects to `/` (not `/sign-in`) and the home notice `You have been signed out.` is shown as a focused status.
- A failed sign-out also redirects to `/` and shows the bounded `signOutError` message as a focused alert.

On 2026-09-26 this suite passed as part of `npm run test:unit` (8 files, 92 tests).
