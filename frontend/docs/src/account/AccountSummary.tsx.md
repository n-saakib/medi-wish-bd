# `src/account/AccountSummary.tsx`

Source: [`src/account/AccountSummary.tsx`](../../../src/account/AccountSummary.tsx)

## Purpose

Client component for the `/account` page: a read-only view of the signed-in user's profile with a sign-out button. It calls `useSessionRedirect('account')`, so only signed-in visitors see it.

## Export

### `AccountSummary()`

- **While restoring** with no profile yet, it renders a `Checking your session…` status and nothing else.
- **Signed out** after the restore, it renders nothing; the account guard redirects to `/sign-in`, or to `/` right after a sign-out.
- **Signed in**, it renders a card headed `Your account` with a definition list of username and mobile, plus email only when the profile has one, and a secondary `Sign out` button.

## Observable behavior

Pressing `Sign out` calls the provider's `signOut`. While it is pending, the button is disabled, reads `Signing out…`, and the guard keeps the visitor on the page. When it settles the profile is cleared, the guard replaces the route with `/`, and the home page's [`SignOutNotice`](../auth/SignOutNotice.tsx.md) announces and focuses the result, whether or not the server confirmed the sign-out.

## Use cases and boundaries

The profile comes from the session restore or sign-in response held by the provider; this component makes no API call and does not load `/api/user/me`. Profile editing, mobile verification, addresses and orders are not part of this slice.

## Verification

[`tests/AccountSummary.test.ts`](../../tests/AccountSummary.test.ts.md) covers the profile with and without email, the restore status and sign-in redirect, and sign-out success and failure including the redirect home and focused announcement.
