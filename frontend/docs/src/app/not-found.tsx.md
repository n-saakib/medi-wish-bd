# `src/app/not-found.tsx`

Source: [`src/app/not-found.tsx`](../../../src/app/not-found.tsx)

## Purpose and behavior

Root unmatched-route view (for example `/products/{id}/x`). It renders the store `SiteHeader` (Logo link home, P14) above the shared translated not-found content in the main landmark, so unmatched URLs keep the store look. It has no category bar, which needs a request-time API read. Storefront resource misses use the store-group file so they retain store chrome.

Known limitation (accepted under P14): every unmatched URL, including staff paths such as `/staff/typo`, gets this customer header. A signed-in staff user therefore sees their username linking to `/account` instead of the staff header. Staff-scoped not-found pages are a possible follow-up, not Ticket 17 scope.

## Verification

Mounted storefront tests cover the shared view's translated recovery link and this page's header Logo link. The shared view and the catalog not-found browser routes passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures. The header was added on 2026-10-22; it has passed only the 2026-10-22 focused checks (ESLint, `tsc`, Vitest unit project on `StorefrontComponents`, `SiteHeader`, `storefront` and `storefrontView`: 4 files, 62 tests on `c9568a6`; 63 after the review round 1 fixes) and a production `next build`, which prerendered `/_not-found` statically with the `a.logo` link to `/`. The browser case for unmatched URLs (E2E-17-09: `/products/{id}/x` and an unknown top-level path answer 404 with the header Logo link home and the not-found copy) passed on Chrome and Edge. On 2026-10-22 the working tree on `c9568a6` with the review fixes passed `npm run verify` (42 files, 1,031 units and the production build) and the Ticket 17 Chrome/Edge browser suites (`--grep "@t17"`: 110 passed, 2 demo skips; `@t17-demo` alone: 2 passed); see the [review follow-up](<../../ticket-17-e2e.md#review-follow-up-2026-10-22>).
