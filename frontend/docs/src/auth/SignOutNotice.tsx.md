# `src/auth/SignOutNotice.tsx`

Source: [`src/auth/SignOutNotice.tsx`](../../../src/auth/SignOutNotice.tsx)

## Purpose

Client component on the home page that announces the result of signing out and lets a failed sign-out be retried. The account page's redirect sends the visitor home after sign-out, so the result is shown on the page they land on.

## Export

### `SignOutNotice()`

Reads the provider's `notice`. For `signedOut` it renders a success status (`You have been signed out.`). For `signOutError` it renders a danger alert (`Sign-out could not be completed.`) with a secondary `Try again` button that calls the provider's `signOut` again. While the retry runs the alert stays and the button is disabled and reads `Signing out…` (the account page's busy label); a successful retry replaces the alert with the `signedOut` status. Both receive focus when shown so screen readers announce them after the navigation. Any other notice renders nothing.

## Use cases and boundaries

`signOutError` still means the local session has ended: the session client drops its in-memory token before calling the API, and the provider clears the profile either way. The retry asks the API again to revoke the refresh cookie. The provider drops the notice once the visitor moves to another page, so it is not repeated on a later visit. It contains no server detail.

## Verification

[`tests/AccountSummary.test.ts`](../../tests/AccountSummary.test.ts.md) mounts this component with the account summary under one provider and checks both messages, their roles and focus, the retry's busy state and a successful retry.
