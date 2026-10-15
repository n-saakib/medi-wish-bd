# `DiscountService.java`

Admin pricing-authorized transactional command and tab-read boundary. Creates validate targets and record one audit snapshot; same UUID/body replays precede current target/date rules. Updates and end lock the row, recognize unchanged retries before stale versions, and atomically record changed intent. Tab pages and counts share a repeatable-read snapshot; target names/counts and usernames are batched projections.

Product target labels use the repository's scalar ID/name projection instead of loading entities and traversing Product fields, so distinct target categories do not add lazy-load queries.

Product and Category labels are resolved in separate UUID maps: caller-selected IDs can coincide across their independent tables, so mixed pages retain the name for each target type without adding queries.
