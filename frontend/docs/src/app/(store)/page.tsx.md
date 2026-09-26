# `src/app/(store)/page.tsx`

Source: [`src/app/(store)/page.tsx`](../../../../src/app/(store)/page.tsx)

## Purpose

The `/` route. It shows the store's preparation message in the home hero and is the page a visitor returns to after signing out, where the sign-out result is announced.

## Export

### `HomePage()`

The async server component loads the `home` namespace with `getTranslations('home')` and renders a `<main>` containing [`SignOutNotice`](../../auth/SignOutNotice.tsx.md) and a `hero-main` section labelled by its `<h1>`. The heading is the store name and the paragraph is the preparation copy. The page has no title export, so the root layout's default title (the store name) applies.

## Use cases and boundaries

The page is built from `agent-docs/ui-design/home.html` but keeps only the hero: the design's offers button, category, product and promotion sections are omitted because the catalog is not implemented, and the hero keeps the preparation copy instead of promotional text. `SignOutNotice` renders nothing unless the session provider holds a sign-out result, so ordinary visits show only the hero.

## Verification

On 2026-09-26 `npm run build` produced `/` as a static route. The sign-out announcement shown here is covered by [`tests/AccountSummary.test.ts`](../../../tests/AccountSummary.test.ts.md); browser verification is recorded in the Ticket 03.01 evidence.
