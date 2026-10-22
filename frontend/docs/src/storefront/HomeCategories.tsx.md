# `src/storefront/HomeCategories.tsx`

Source: [`src/storefront/HomeCategories.tsx`](../../../src/storefront/HomeCategories.tsx)

Request-time home section backed by the same React-cached category read as the category bar. It shows up to eight links and a See all destination when categories are available, and hides the entire section when the list is empty or unavailable under accepted P10 behavior. It adds no offer or Most Sold content.

Verification: Ticket 17 browser page and outage tests cover the rendered section and its graceful failure behavior. They remain unrun while the baseline browser suite uses `.next`.
