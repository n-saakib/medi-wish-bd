# src/lib/discounts.ts

Typed discount HTTP boundary: strict bounded discount/page projections; calendar-date validation; Dhaka today; list, create, update and end paths with exact version/UUID bodies. Money stays a string. Success responses use the catalog 256 KiB limit; API failures preserve bounded codes rather than remote copy. Projections include live counts, target metadata and audit fields.

Verified by the focused discount client/component tests; real API/browser verification is recorded separately by Ticket 16.

Enum fields use direct literal comparisons before projection; arrays and other non-string values are rejected rather than coerced. The shared value projection enforces this boundary for catalog applied discounts and derived history too.
