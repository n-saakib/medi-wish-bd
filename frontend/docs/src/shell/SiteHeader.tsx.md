# `src/shell/SiteHeader.tsx`

Source: [`src/shell/SiteHeader.tsx`](../../../src/shell/SiteHeader.tsx)

## Purpose

Client component for the sticky store header on `/` and `/account`. It shows the logo and one account link whose target depends on the session.

## Export

### `SiteHeader()`

Renders the [`Logo`](Logo.tsx.md) and a `<nav>` labelled `Account`. After the session restore finishes it contains either a `Sign in` link to `/sign-in` or, when signed in, a link to `/account` labelled with the username. Both links carry the `user` icon.

## Observable behavior

- While the restore is running the navigation is empty, so the header never flashes the wrong state (for example `Sign in` for a user who is about to be restored).
- At 860 px and below the link label is visually hidden rather than removed, so the icon-only link keeps its accessible name. Long usernames are truncated visually at 24 characters.

## Design deviations

The design's header search, cart, track-order link, category navigation and site footer are omitted because those features are not implemented; the header is logo plus `Sign in` or the username only.

## Verification

[`tests/SiteHeader.test.ts`](../../tests/SiteHeader.test.ts.md) covers the signed-out and signed-in links and the empty state during restore. Responsive behavior is verified in the browser; see the Ticket 03.01 evidence.
