# `src/i18n/request.ts`

Source: [`../../../src/i18n/request.ts`](../../../src/i18n/request.ts)

## Purpose

This is the `next-intl` request configuration. It chooses the current locale and loads the message catalog for server components such as the root layout and home page.

## Export

### Default `getRequestConfig(...)`

The default export is the request configuration produced by `getRequestConfig`. Its callback returns:

- `locale: 'en'`, which makes English the current supported locale;
- `messages`, loaded by dynamic import from `messages/en.json`.

The dynamic import lets the internationalization plugin load the catalog through Next.js’s supported request boundary instead of relying on mutable global state. The locale is intentionally fixed because locale selection and additional catalogs are not part of the current launch slice.

## Use cases and boundaries

`next-intl` consumes this configuration for each request, and `getTranslations` in server components resolves the namespaces from it. Adding another locale requires an explicit locale-selection policy and catalog; changing only the string here would not provide a complete localization feature.

## Verification

The Next.js build exercises plugin discovery and message loading. TypeScript checking verifies the imported JSON and configuration shape. The visible message consumers are documented in [`src/app/layout.tsx`](../app/layout.tsx.md) and [`src/app/page.tsx`](../app/page.tsx.md).
