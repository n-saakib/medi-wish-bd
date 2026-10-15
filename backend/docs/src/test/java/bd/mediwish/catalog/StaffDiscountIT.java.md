# StaffDiscountIT.java

Real HTTP/PostgreSQL integration contract for I1. Moves only the promotion calendar across scheduled, first/start, last/end and next/expired dates; list/detail prices agree, unpriced Products remain null, and expired transitions write no promotion rows. Staff authentication remains usable after calendar movement.

Pins global Active/Scheduled counts on every status page, derived history for winning and losing Discounts, End-now actor versus date-end null actor, absence of events for a future promotion ended before its start, and the prohibition on storing derived Product history rows. A Moderator can read Product prices but cannot administer Discounts; restricted staff sessions receive the existing MFA error.

A legitimate synthetic stored history event at the exact derived start instant verifies newest-first ordering and that stored rows precede derived events on a tie.

Cross-story 14/16: Moderator Category moves select the current Category's Discount and its derived history; later Category deactivation retains the promotion. Discount rows/audit remain unchanged. Equal savings prefer earlier start before identity, then UUID string order rather than signed UUID ordering. An ordinary catalog application proves the movable test bean is not scanned.

The history value assertion projects the contract's decimal string explicitly, avoiding wildcard map types in the compile-time assertion.

Requires Ticket 16 production contracts and PostgreSQL. Fixtures use fixed promotion date 2020-01-15 with the auth clock untouched. These tests do not claim cart or accepted Order implementation.

The per-request midnight case arms the calendar between fixture creation and each GET. An ending promotion and a next-day starting promotion pin Active/Scheduled membership and global counts, then effective price and exact derived history on one detail response. A subsequent GET verifies the later date. Repeated calendar sampling that mixes dates is observable even when both days have one Active promotion.

A two-Product page separately pins a shared request date across midnight: both rows use the ending Category promotion and their own base prices on the first GET; a fresh page uses the next-day promotion for both. Every returned row and the page cardinality are asserted.

The history source-limit regression creates and cancels twenty later scheduled Product Discounts through HTTP, verifies that every cancellation precedes its Dhaka start instant, then moves the promotion calendar past all those starts. The older applied Discount must still appear as the sole derived start event; canceled promotions cannot consume the bounded source query and suppress actual history.
