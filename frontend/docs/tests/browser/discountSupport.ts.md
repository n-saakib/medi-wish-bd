# Discount end-to-end support

`tests/browser/discountSupport.ts` owns the Ticket 16 expected wire contract independently of production code. `DiscountDraft`, `DiscountEdit`, `Discount`, `DiscountPage`, `DiscountProduct`, `AppliedDiscount`, `HistoryDiscount` and `PublicPrice` represent the accepted D1–D9 contracts. Monetary values remain strings; these helpers never calculate an effective price.

`discountApi(actor)` uses Ticket 14's renewable `ApiActor` sessions for create, update, end and paged status lists. `discountDraft` gives every create a fresh UUID and today's Dhaka date. `discountBody` retains only editable fields and version. `allDiscounts` follows pages in the shared synthetic catalog. `getDiscountProduct` and `publicPrice` read real staff detail and anonymous price routes.

`expectDiscountJson`, `expectDiscountError` and `expectDiscountShape` check no-store, request correlation, exact response keys, full UUID group lengths, decimal strings, status, version and tab counts. Every error, including HTTP 400, has exactly `code`, `message` and `requestId`. No diagnostic body is printed in failure messages.

`dhakaToday`, `dhakaTomorrow` and `dateOffset` create explicit date-only fixtures. `assertAwayFromDhakaMidnight` rejects 17:55–18:05 UTC to prevent a date transition during real API/browser assertions. Every date-dependent discount spec calls it in `beforeEach`.

`discountManager` and `discountDialog` locate controls by accessible names from the plan. The Type select and target select are independent; target Category / One product radios retain their own locators. `expectLabelledTargets` verifies visible controls have accessible names and 44px targets, measuring enclosing radio/checkbox labels.

Pure date, body-building, wire assertions and client-route behavior are covered by `tests/discountSupport.test.ts`.

Response guards also enforce canonical bounded positive flat money, real calendar dates and UTC instants, nullable updater names, requested Product identity, exact staff Product/history envelopes, the 20-entry history limit, valid derived discount values and all six stored fields null on derived events. Stored events require `discount: null`. Anonymous prices validate identity, positive selling/effective prices and optional MRP, nonnegative saving and a null-or-valid discount projection without computing prices.

`expectAppliedDiscountShape` checks an explicit null or the exact six-field staff descriptor, a full UUID, target/kind enums, nonempty target name, canonical value and positive bounded saving. Detail reads invoke it automatically; promoted list checks invoke it explicitly.

Response prices conserve selling price using integer cents: effective price plus saving equals selling price. A public discount is null exactly when saving is zero; staff null descriptors imply the unchanged selling price, and unpriced Products require null effective price, descriptor and MRP. Optional MRP cannot be lower than selling price. Product history accepts only the six existing stored types and the two derived Discount types. These are consistency checks, not a second winning-discount calculator.

Paged Discount items and Product history must be actual arrays before bounds or iteration; empty strings and array-like objects cannot silently represent an empty collection. Genuine empty arrays remain valid.

For an applied FLAT descriptor, its amount must equal the saving in exact integer cents in both staff and public projections. This direct contract invariant rejects a conserving price/saving pair with a mismatched displayed amount; percentage rounding and winner selection remain independently specified by worked acceptance cases.
