# `src/app/page.tsx`

Source: [`../../../src/app/page.tsx`](../../../src/app/page.tsx)

## Purpose

This is the current root route and a deliberately small storefront placeholder. It proves that the Next.js App Router, server-side translations, root layout, and global styling are wired together before product features are added.

## Export

### `HomePage()`

The async server component loads the `home` namespace with `getTranslations('home')`. It renders a semantic `<main>` containing a translated heading and explanatory paragraph. There is no client state, data fetch, authentication requirement, or product logic in this slice.

Using a server component keeps the initial page free of browser JavaScript for behavior it does not need and makes the message lookup happen within the request’s locale configuration.

## Use cases and boundaries

The route is the public entry point while the online store is being prepared. Future home-page merchandising can replace or extend this component with product and cart features while preserving the shared shell. Product ranking, search, pricing, and ordering are not implemented here.

## Verification

`next build` and strict TypeScript checking validate the async server component and message calls. The rendered heading and paragraph are suitable for a browser smoke check; no dedicated page test exists yet because the route has no behavior beyond composition.
