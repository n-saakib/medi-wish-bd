# `src/app/not-found.tsx`

Source: [`src/app/not-found.tsx`](../../../src/app/not-found.tsx)

## Purpose and behavior

Root unmatched-route view. It wraps the shared translated not-found content in the main landmark. Storefront resource misses use the store-group file so they retain store chrome.

## Verification

Mounted storefront tests cover the shared view's translated recovery link; browser checks cover catalog not-found routes. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
