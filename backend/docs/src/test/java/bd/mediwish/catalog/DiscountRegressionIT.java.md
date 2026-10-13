# DiscountRegressionIT.java

Tagged real HTTP/PostgreSQL regression suite for R1. Every create/edit/end is followed by fingerprints of all unrelated tables and an unchanged stored Product row. Session/migration bookkeeping is excluded; Discount tables hold one audit per actual mutation.

Repeated anonymous/list/detail reads never compound discounts. A `CurrentPrices.forProduct` call from a thread without a caller transaction captures an immutable value snapshot; later edits/end change fresh reads while all captured components retain their values. Frozen-tuple retention compares component strings, avoiding `Money`/record identity equality; expected saving and Discount-value assertions compare decimals numerically. Admin selling-price changes recompute the discount while stored Product history records the selling price only.

Application restart preserves create replay; dropped create/update/end responses and identical old-version retries produce no duplicate audit. Captured logs omit distinctive money, target names and credentials. Persisted role demotion immediately denies the old Admin token.

Requires planned `CurrentPrices`/`EffectivePrice` and discount persistence. Order-line acceptance/reduction snapshot regressions remain downstream Ticket 25/39 work, not mocked here.

Persisted Admin demotion is checked with the original bearer against list, valid new create, changed update of a live Discount and End-now. Every mutation must yield bounded 403 ACCESS_DENIED; Discount/audit and unrelated-table fingerprints remain unchanged after demotion. The live fixture prevents already-ended rules from masking authorization defects.

Every denied demoted-token response (list/create/update/end) is checked for bounded errors and privacy; shared sentinels include all successful and denied distinctive discount values, base price, Product name and bearer token. The same sentinels are checked in captured output.

The direct CurrentPrices snapshot regression independently pins all initial and fresh-after-edit component values: Product identity, selling/MRP/effective price, saving, Discount ID/target/kind/value and pricing date. End clears every Discount metadata component, restores the base price and zero saving, while the original captured tuple remains unchanged. Saving and Discount value compare numerically to avoid imposing BigDecimal scale normalization.
