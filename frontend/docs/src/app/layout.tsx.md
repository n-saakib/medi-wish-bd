# `src/app/layout.tsx`

Source: [`src/app/layout.tsx`](../../../src/app/layout.tsx)

## Purpose

This file defines the Next.js App Router document shell shared by every route. It supplies page metadata from the message catalog and mounts the translation and session providers once, so the `(store)` and `(auth)` route groups share one signed-in state.

## Exports

### `generateMetadata(): Promise<Metadata>`

This server function reads the `metadata` namespace through `getTranslations` and returns a title object with `default` set to the store name and `template` set to `%s · <store name>`, plus the translated `description`. Route pages that export their own title (`Sign in`, `Create an account`, `Your account`) are therefore rendered as, for example, `Sign in · Medi Wish`, while the home page keeps the plain store name.

### `RootLayout({ children })`

The async default layout loads the configured messages with `getMessages` and renders `<html lang="en">` and `<body>` around `NextIntlClientProvider`, which wraps [`SessionProvider`](../auth/SessionProvider.tsx.md) around the route content. It imports `globals.css` once, so every route receives the ported design tokens and component styles.

## Use cases and boundaries

Every route passes through this shell, which makes it the place for document metadata, global CSS, the client translation context and the single session provider. Because the provider sits above both route groups, the session is restored once per page load and survives client-side navigation between the home, account, sign-in and registration pages. The layout itself holds no session state and makes no API calls; the provider and the feature components own those concerns. Route-group layouts ([`(store)`]((store)/layout.tsx.md) and [`(auth)`]((auth)/layout.tsx.md)) add the page headers.

## Verification

TypeScript checking verifies the `Metadata` shape and readonly children contract. On 2026-09-26 `npm run build` compiled the layout and produced static `/`, `/account`, `/register` and `/sign-in` routes. The provider's behavior is covered by [`tests/SessionProvider.test.ts`](../../tests/SessionProvider.test.ts.md); browser verification of the rendered titles and pages is recorded in the Ticket 03.01 evidence.
