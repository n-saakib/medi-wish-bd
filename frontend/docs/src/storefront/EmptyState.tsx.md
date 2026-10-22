# `src/storefront/EmptyState.tsx`

Source: [`src/storefront/EmptyState.tsx`](../../../src/storefront/EmptyState.tsx)

Shared server-rendered state for an empty category directory or a valid category with no listable Products. It accepts localized title, explanation and recovery-link text, and gives the link a 44 px target. It contains no API or error handling; the route decides when the state applies.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers the message and recovery link. They passed in the [2026-10-21 completion verification](<../../ticket-17-e2e.md#completion-verification-2026-10-21>) on `c63359c` plus the Ticket 17 working tree: 1,024 units in `npm run verify` and 1,164 Chrome/Edge browser cases with zero failures.
