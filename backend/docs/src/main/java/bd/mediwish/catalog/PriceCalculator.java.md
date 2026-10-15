# `PriceCalculator.java`

Pure exact-decimal greatest-saving calculation. Filters wrong target, scheduled/ended, rounded-zero and nonpositive-result candidates; percentage saving rounds HALF_UP to two places. Ties prefer Product, earlier start, then lexicographically smaller UUID. Discounts never stack, and fallback is current Selling Price.

## Accepted price contract

Inputs: the stored `sellingPrice` (a `Money`, or null when unpriced), the stored `mrp` (a `Money` or null), the Product id, the Product's category id, and **today** (a `LocalDate` in Asia/Dhaka from `DiscountCalendar`).

1. **Unpriced Product.** If `sellingPrice` is null, there is no effective price and no applied Discount. `CurrentPrices` leaves unpriced Products out before calling the calculator, so `PriceCalculator.price` requires a non-null `sellingPrice` (`Objects.requireNonNull`).
2. **Input guard.** If `mrp` is set and `sellingPrice > mrp`, the calculator throws `IllegalStateException`. The DB check `ck_products_price_le_mrp` already makes this impossible; the throw makes an invalid MRP relationship fail loudly and never yield a price.
3. **Candidates.** A Discount is a candidate when all of these hold:
   - it targets this Product, or this Product's current Category (§3, "Category moves"; the Category's active state is not checked);
   - `ended_at IS NULL`;
   - `startsOn ≤ today`;
   - `endsOn` is null or `endsOn ≥ today` (D1-A).
4. **Saving per candidate.**
   - PERCENTAGE: `saving = sellingPrice × percent / 100`, scaled to 2 decimals with `RoundingMode.HALF_UP` (D2-A).
   - FLAT: `saving = amount`.
5. **Eligibility.** A candidate is eligible only if `saving ≥ 0.01` and `sellingPrice − saving ≥ 0.01` (D4-A). Otherwise it is skipped, so a percentage that rounds to a zero saving is never shown as applied (README principle 2).
6. **Choice.** Take the eligible candidate with the greatest saving. On equal saving, apply D5-A: Product target first, then earlier `startsOn`, then smaller `id.toString()`.
7. **Result.** `price = sellingPrice − saving`, with scale 2. With no eligible candidate, `price = sellingPrice` and `saving = 0.00`.
8. **Never stacked.** The result uses exactly one Discount, or none. The input is always the **stored** selling price, never an earlier result, so a Discount cannot apply twice.
9. **Always within bounds.** `0.01 ≤ price ≤ sellingPrice ≤ mrp` (when `mrp` is set). This meets FR-PRICE-03 (a discounted price never exceeds MRP).
10. **BDT only.** All amounts are BDT decimals with 2 places. Responses carry them as strings, for example `"127.50"`.
11. **Time.** "Today" is computed once per request: `LocalDate.now(clock.withZone(ZoneId.of("Asia/Dhaka")))`. SQL receives it as a `date` parameter. SQL never calls `now()` or `current_date`. The last instant of `endsOn` is 23:59:59.999999 Dhaka. The first instant of `startsOn` is 00:00 Dhaka.

**Worked examples.** These are the U1 fixtures; T1 records them as executable cases.

| # | Selling | MRP | Candidates | Today | Price | Applied |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 150.00 | 150.00 | Product 10%, Category 15% | inside both | 127.50 | Category 15% |
| 2 | 150.00 | — | Product flat 20.00, Category 10% | inside both | 130.00 | Product flat |
| 3 | 200.00 | — | in this list order: Category flat 20.00 from 2026-10-01 with id `00000000-0000-4000-8000-000000000001`, then Product 10% from 2026-10-05 with id `00000000-0000-4000-8000-000000000002` | 2026-10-09 | 180.00 | Product 10% (tie, D5 Product first) |
| 4 | 123.45 | — | Category 10% | inside | 111.10 | Category 10% (saving 12.345 → 12.35) |
| 5 | 0.05 | — | Product 50% | inside | 0.02 | Product 50% (0.025 → 0.03) |
| 6 | 0.01 | — | Product 99% | inside | 0.01 | none (saving 0.0099 → 0.01 leaves 0.00, so ineligible) |
| 7 | 10.00 | — | Product flat 10.00 | inside | 10.00 | none (flat ≥ price) |
| 8 | 100.00 | — | Product 10% from 2026-10-10 to 2026-10-12 | 2026-10-09 | 100.00 | none |
| 9 | same | | same | 2026-10-10 | 90.00 | Product 10% |
| 10 | same | | same | 2026-10-12 | 90.00 | Product 10% |
| 11 | same | | same | 2026-10-13 | 100.00 | none |
| 12 | 100.00 | — | Product 10%, `ended_at` set | inside | 100.00 | none |
| 13 | 160.00 | 150.00 | any | any | throws | — |
| 14 | 123.44 | — | Category 10% | inside | 111.10 | Category 10% (saving 12.344 → 12.34) |
| 15 | 100.00 | — | in this list order: Product 10% from 2026-10-05 with id `00000000-0000-4000-8000-000000000001`, then Product 10% from 2026-10-01 with id `00000000-0000-4000-8000-000000000002` (same target, overlapping, D6) | 2026-10-09 | 90.00 | the one from 2026-10-01 (tie, D5 earlier `startsOn`) |
| 16 | 100.00 | — | Product 10% with id `80000000-0000-4000-8000-000000000000`, Product 10% with id `00000000-0000-4000-8000-000000000001`, same `startsOn` | inside | 90.00 | the `00000000-…-0001` one (tie, D5 smaller `id.toString()`) |
| 17 | 0.40 | — | Product 1% | inside | 0.40 | none (saving 0.004 → 0.00, so ineligible) |

`DiscountCalendarTest` covers the instants: `2026-10-09T17:59:59.999999Z` gives today `2026-10-09`, and `2026-10-09T18:00:00Z` gives `2026-10-10`.
