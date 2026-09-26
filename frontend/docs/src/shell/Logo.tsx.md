# `src/shell/Logo.tsx`

Source: [`src/shell/Logo.tsx`](../../../src/shell/Logo.tsx)

## Purpose

The store logo used by both headers: a link to `/` containing the green `plus` mark and the translated brand name (`header.brand`).

## Export

### `Logo()`

Renders `<a class="logo" href="/">` via `next/link`. The icon is decorative, so the link's accessible name is the brand text. The component has no client directive; it renders as a server component inside [`AuthHeader`](AuthHeader.tsx.md) and as part of the client tree inside [`SiteHeader`](SiteHeader.tsx.md).

## Verification

[`tests/SiteHeader.test.ts`](../../tests/SiteHeader.test.ts.md) checks that the logo links to `/`.
