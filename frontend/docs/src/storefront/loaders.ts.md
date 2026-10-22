# `src/storefront/loaders.ts`

Source: [`src/storefront/loaders.ts`](../../../src/storefront/loaders.ts)

## Purpose and behavior

Server-only React-cached request-time loaders for the category list, category pages and Product details. Each loader calls `connection()` and uses the anonymous, bounded storefront client. React request caching lets layout navigation, the home grid and page metadata share a consistent response. `categoriesOrNull()` catches failures only for navigation and home; `/categories`, category and Product pages call the strict loaders so failures reach the error boundary.

## Verification

Storefront API units cover the client boundaries; browser page and outage tests cover the category-bar and home fallbacks. They were authored but were not run while the baseline browser suite uses `.next`.
