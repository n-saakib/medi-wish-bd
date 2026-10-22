# `src/storefront/EmptyState.tsx`

Source: [`src/storefront/EmptyState.tsx`](../../../src/storefront/EmptyState.tsx)

Shared server-rendered state for an empty category directory or a valid category with no listable Products. It accepts localized title, explanation and recovery-link text, and gives the link a 44 px target. It contains no API or error handling; the route decides when the state applies.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers the message and recovery link. Ticket 17 tests remain unrun while the baseline browser suite uses `.next`.
