# `src/app/page.tsx`

Source: [`../../../src/app/page.tsx`](../../../src/app/page.tsx)

## Purpose

This is the current root route and a deliberately small storefront entry point. It composes the preparation message with the Ticket 02 User access panel while keeping page-level copy server-translated.

## Export

### `HomePage()`

The async server component loads the `home` namespace with `getTranslations('home')`. It renders a semantic `<main>` containing a translated heading, explanatory paragraph and `UserAccessPanel`, which owns the client-side registration/sign-in interactions.

Using a server component keeps page composition and message lookup on the server while isolating browser state and API calls in the feature client component.

## Use cases and boundaries

The route is the public entry point while the online store is being prepared. Future home-page merchandising can replace or extend this component with product and cart features while preserving the shared shell. Product ranking, search, pricing, and ordering are not implemented here.

## Verification

`next build` and strict TypeScript checking validate the async server component and message calls. The rendered heading and paragraph are suitable for a browser smoke check; no dedicated page test exists yet because the route has no behavior beyond composition.
