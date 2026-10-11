# `src/account/AccountSummary.tsx`

Source: [`src/account/AccountSummary.tsx`](../../../src/account/AccountSummary.tsx)

## Purpose and export

`AccountSummary()` renders the guarded `/account` card. Once the session is restored, it loads `GET /api/user/me` through `loadUserProfile` and the provider's `authenticatedFetch`. This existing endpoint remains separate from the nine-field editable profile endpoint.

## Observable behavior

The card shows username, current mobile and email when present. A loaded account provides an **Edit profile** link to the fixed `/account/profile` path, followed by Sign out. Loading uses a status; a failed load shows a generic translated alert and keeps sign-out available. Signed-out visitors follow the account guard, and a request still unauthorized after one refresh expires the session.

Sign out disables the button while pending. The provider clears the session whether the server succeeds or fails, then the home page announces the result and offers a retry on failure. Answers arriving after an effect cleanup are ignored. Server error details and identifiers never enter URLs or errors.

## Verification

[`tests/AccountSummary.test.ts`](../../tests/AccountSummary.test.ts.md) covers loading, profile projection, expiry, error and sign-out states. Ticket 11 browser tests exercise the Edit profile navigation.

Ticket 12 adds the secondary Addresses link to /account/addresses next to Edit profile. Both are visible for the loaded caller account, including staff own accounts.
