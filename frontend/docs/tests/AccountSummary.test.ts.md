# `tests/AccountSummary.test.ts`

Source: [`tests/AccountSummary.test.ts`](../../tests/AccountSummary.test.ts)

## Purpose

Mounted jsdom coverage for [`AccountSummary`](../src/account/AccountSummary.tsx.md) and [`SignOutNotice`](../src/auth/SignOutNotice.tsx.md) through [`renderWithSession`](renderWithSession.ts.md), with `next/navigation` mocked (router plus a fixed `/account` pathname). Each case uses a real session client over the [`fakeApi`](fakeApi.ts.md) routes, whose refresh cookie is accepted and whose `/api/user/me` returns the synthetic profile unless the case overrides a route. The sign-out cases mount both components under one provider, as the root layout shares one provider between the account and home pages. [`installFakeLocks`](fakeApi.ts.md) supplies the Web Locks that jsdom lacks and the real session client requires.

## Verification

- While the profile request is held open, `Checking your session…` is shown without a heading; the loaded card then shows the API's username, mobile and email (not the restored ones), the request carries the Bearer token, and nothing redirects. A profile without email has no email row.
- While the restore is held open, the status is shown without redirecting; a `204` restore then redirects to `/sign-in` without requesting the profile.
- A profile request that is still `401` after one refresh makes two profile and two refresh requests, removes the card, redirects to `/sign-in`, and the sign-in form mounted alongside announces the expired session.
- A `500` profile response shows the generic alert (not the API message) and keeps the heading and sign-out button, without redirecting.
- Sign-out disables the button with `Signing out…` and stays on the page while pending; on success it redirects to `/` (not `/sign-in`) and `You have been signed out.` is shown as a focused status.
- A failed sign-out redirects to `/` and shows `Sign-out could not be completed.` with a `Try again` button as a focused alert; pressing it keeps the alert with a disabled `Signing out…` button while the logout repeats, then announces `You have been signed out.` with focus.

On 2026-09-26 this suite passed as part of `npm run test:unit`.
