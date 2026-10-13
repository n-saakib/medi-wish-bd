# `DiscountHistory.java`

Derives Product Discount transitions at start-of-day Dhaka or explicit end time; date-ended transitions occur on the next Dhaka day. Never persists derived rows. Excludes scheduled or ended-before-start rows, batches explicit-end actor usernames, and renders whole percentage values without decimal scale.
