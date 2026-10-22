# `src/storefront/CategoryNav.tsx`

Source: [`src/storefront/CategoryNav.tsx`](../../../src/storefront/CategoryNav.tsx)

## Purpose and behavior

Request-time server component mounted below the storefront header. It uses the shared React-cached category loader and returns nothing when the list is empty or unavailable, as required by P10. Available categories are rendered by [`CategoryNavLinks`](CategoryNavLinks.tsx.md).

## Verification

Mounted tests cover the named navigation landmark, first eight category links and the All categories destination. Tests are authored but not run while the baseline browser suite uses `.next`.
