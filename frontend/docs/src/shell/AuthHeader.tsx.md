# `src/shell/AuthHeader.tsx`

Source: [`src/shell/AuthHeader.tsx`](../../../src/shell/AuthHeader.tsx)

## Purpose

The reduced header for `/sign-in` and `/register`: the [`Logo`](Logo.tsx.md) and a ghost button linking back to `/`.

## Export

### `AuthHeader()`

Server-rendered header containing the logo and a `next/link` to `/` with a left-chevron icon and the text `Back to home` (`header.backHome`). It reads no session state.

## Observable behavior and design deviations

At 480 px and below the button padding shrinks and the `Back to home` text is visually hidden, not removed, so the chevron-only link keeps its accessible name. The design labels this link `Continue shopping` and uses a small (`btn-sm`) button; here it reads `Back to home` with a left chevron, because there is no catalog to continue shopping in yet, and uses the standard button so the target stays at least 44 px tall.

## Verification

Checked by `npm run typecheck` and `npm run build` on 2026-09-26. There is no dedicated unit test; browser verification is recorded in the Ticket 03.01 evidence.
