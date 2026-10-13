# Discount browser-helper unit tests

`tests/discountSupport.test.ts` validates test fixtures independently of the future Discount implementation. Dhaka date cases cover both sides of 18:00 UTC, year-end rollover and leap-day transitions. The midnight guard fails at and inside its five-minute bounds and accepts ordinary times. Date-offset cases move in both directions across months and years.

Wire-helper cases prove unique create IDs, full UUID group lengths, string money/date defaults, explicit overrides and update-body allow-lists. Stubbed HTTP responses verify create/update/end routes, full edit bodies, status-list defaults and requested page sizes. Invalid counts and extra page fields are refused. Success assertions require no-store and a request id; error assertions enforce exactly three keys even for HTTP 400 and require header/body correlation.

These focused units test the non-trivial helper logic used by the API, database and browser specifications. They require neither PostgreSQL nor a running application and run under the normal frontend unit-test command.

Negative projection cases reject zero/oversized/noncanonical flat values, impossible dates or instants, invalid updater types, corrupt optional public discount/MRP values, wrong Product identity, excessive or leaky history, populated stored fields on derived events and non-null discounts on stored events. Valid null projections and canonical flat/percentage projections remain accepted.

Applied-discount negatives reject extra internal fields, malformed UUIDs, invalid enums/names/canonical values/savings and false optional projections; valid null, percentage and flat descriptors pass. Detail-reader negatives prove that the nested guard is applied.

Price-consistency negatives reject missing descriptors with a reduced price, descriptors with zero saving, mismatched sums, effective prices above selling price, unpriced Products with price/descriptor data and MRP below selling price. Valid discounted, unchanged and unpriced projections pass, including a valid sub-taka HALF_UP example (50% of 0.05 saves 0.03). Unknown history types are rejected even when their discount is null.

Collection-shape negatives reject empty strings, null, plain/array-like objects, booleans, numbers and undefined for Discount items and Product history; positive empty arrays remain accepted.

Applied FLAT controls use equal amount/saving, including a valid 20.00 staff detail. Negatives reject a valid-format 20.00 flat amount with saving15.00 even when 150.00 selling price and135.00 effective price conserve the total; the public and nested staff readers both enforce this invariant.
