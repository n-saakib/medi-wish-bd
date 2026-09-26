# `src/app/(store)/account/page.tsx`

Source: [`src/app/(store)/account/page.tsx`](../../../../../src/app/(store)/account/page.tsx)

## Purpose

The `/account` route: the signed-in user's read-only profile and the sign-out action, shown under the store header.

## Exports

### `generateMetadata(): Promise<Metadata>`

Returns the translated `account.title` (`Your account`), which the root layout's template renders as `Your account · Medi Wish`.

### `AccountPage()`

Renders a `<main>` with the `auth-card` width and [`AccountSummary`](../../../account/AccountSummary.tsx.md), which owns the session-dependent content and redirects.

## Use cases and boundaries

The page is statically generated. Whether a visitor is signed in is known only in the browser after the session provider's restore, so the server output carries no profile data and the client component decides what to show or where to redirect. The design's profile page (`account-profile.html`) belongs to a later ticket (T11, profile and mobile verification); this slice shows only username, mobile and optional email, reusing the card, definition-list and button styles already ported.

## Verification

On 2026-09-26 `npm run build` produced `/account` as a static route. Account behavior, including the restore status, redirects and sign-out, is covered by [`tests/AccountSummary.test.ts`](../../../../tests/AccountSummary.test.ts.md).
