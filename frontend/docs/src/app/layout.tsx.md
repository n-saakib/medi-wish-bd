# `src/app/layout.tsx`

Source: [`../../../src/app/layout.tsx`](../../../src/app/layout.tsx)

## Purpose

This file defines the Next.js App Router document shell shared by every route. It also supplies page metadata through the same message catalog used by the UI.

## Exports

### `generateMetadata(): Promise<Metadata>`

This server function reads the `metadata` namespace through `getTranslations` and returns the translated `title` and `description` in Next.js’s `Metadata` shape. Keeping metadata in `messages/en.json` avoids a second hard-coded copy of the store name and description and leaves room for future locale support.

### `RootLayout({ children })`

The default layout accepts immutable React children and renders the required `<html lang="en">` and `<body>` elements around them. It imports `globals.css` once at the root, so every route receives the baseline styles. The fixed language matches the current single-locale request configuration.

## Use cases and boundaries

Every current and future App Router page passes through this shell, making it the correct place for document metadata and global CSS. It deliberately contains no authentication state, API calls, navigation, or feature layout; those concerns should be introduced only when a corresponding storefront feature is implemented.

## Verification

TypeScript checking verifies `Metadata` and the readonly children contract. `next build` verifies the server component, metadata generation, and global stylesheet integration. The visible result is currently exercised by the foundation page.
