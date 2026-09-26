# `src/app/(store)/layout.tsx`

Source: [`src/app/(store)/layout.tsx`](../../../../src/app/(store)/layout.tsx)

## Purpose

Layout for the storefront route group. `(store)` is a Next.js route group, so it adds no URL segment: it covers `/` and `/account` and places the store header above them.

## Export

### `StoreLayout({ children })`

Renders [`SiteHeader`](../../shell/SiteHeader.tsx.md) followed by the route content. Each page supplies its own `<main>` element. The layout is a server component; the header is the client component that reads the session.

## Use cases and boundaries

Separating the store and auth groups lets the storefront and account pages share the full store header while sign-in and registration use the simpler [auth layout](../(auth)/layout.tsx.md). The session provider is not mounted here but in the [root layout](../layout.tsx.md), so the signed-in state is shared across both groups.

## Verification

On 2026-09-26 `npm run typecheck` and `npm run build` passed, and the build produced static `/` and `/account`. Header behavior is covered by [`tests/SiteHeader.test.ts`](../../../tests/SiteHeader.test.ts.md).
