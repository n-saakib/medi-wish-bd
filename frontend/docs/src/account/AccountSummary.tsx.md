# `src/account/AccountSummary.tsx`

Source: [`src/account/AccountSummary.tsx`](../../../src/account/AccountSummary.tsx)

## Purpose

Client component for the `/account` page: the signed-in user's current profile from the API, with a sign-out button. It calls `useSessionRedirect('account')`, so only signed-in visitors see it.

## Export

### `AccountSummary()`

Once the provider has a profile, it loads the current one with [`loadUserProfile`](../lib/user.ts.md) through the provider's `authenticatedFetch` (`GET /api/user/me`).

- **Loading.** While the session restores or the profile loads, it renders a `Checking your session…` status and nothing else.
- **Signed out** after the restore, it renders nothing; the account guard redirects to `/sign-in`, or to `/` right after a sign-out.
- **Loaded.** A card headed `Your account` with a definition list of username and mobile from the API response, plus email only when the profile has one, and a secondary `Sign out` button.
- **Load failed.** The same card with a generic danger alert instead of the list; sign-out stays available.
- **Expired.** If the profile request is still unauthorized after the session client's single refresh, the provider ends the session, the guard sends the visitor to `/sign-in`, and the sign-in page announces the expiry.

## Observable behavior

Pressing `Sign out` calls the provider's `signOut`. While it is pending, the button is disabled, reads `Signing out…`, and the guard keeps the visitor on the page. When it settles the profile is cleared, the guard replaces the route with `/`, and the home page's [`SignOutNotice`](../auth/SignOutNotice.tsx.md) announces and focuses the result, whether or not the server confirmed the sign-out.

## Use cases and boundaries

A result that arrives after the profile changed or the component unmounted is ignored. Error details are never shown. Profile editing, mobile verification, addresses and orders are not part of this slice.

## Verification

[`tests/AccountSummary.test.ts`](../../tests/AccountSummary.test.ts.md) mounts the component with a real session client over a fake API and covers loading, the API profile with and without email, the restore status and sign-in redirect, expiry after the single retry, the generic error, and sign-out success, failure and retry.
