# `src/app/(auth)/layout.tsx`

Source: [`src/app/(auth)/layout.tsx`](../../../../src/app/(auth)/layout.tsx)

## Purpose

Layout for the authentication route group. `(auth)` adds no URL segment: it covers `/sign-in` and `/register` and gives them the reduced auth header and a centered form card, as in `agent-docs/ui-design/sign-in.html` and `register.html`.

## Export

### `AuthLayout({ children })`

Renders [`AuthHeader`](../../shell/AuthHeader.tsx.md) and a `<main className="auth-wrap">` containing a 440 px `auth-card` that holds the page content. Because the layout owns `<main>`, the sign-in and registration pages render only their heading, alerts, form and link.

## Use cases and boundaries

Sign-in and registration are focused tasks, so this group omits the store header's account link and shows only the logo and a way back home. The session provider comes from the [root layout](../layout.tsx.md), so a sign-in here updates the same state the [store layout](../(store)/layout.tsx.md) header reads.

## Verification

On 2026-09-26 `npm run typecheck` and `npm run build` passed, and the build produced static `/sign-in` and `/register`. Browser verification of the layout is recorded in the Ticket 03.01 evidence.
