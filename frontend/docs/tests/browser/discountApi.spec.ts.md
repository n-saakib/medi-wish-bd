# Discount API end-to-end specifications

`tests/browser/discountApi.spec.ts` calls the built application and isolated PostgreSQL browser schema through real HTTP. It uses test-owned expected shapes and values, with no production projection or calculator imports. Native Playwright tags identify `@t16` and the owning T4, T5 or T6 sub-ticket. Fixtures use unique names and UUID suffixes because Chrome and Edge share the run schema.

Planned acceptance IDs cover:

- E2E-16-01: anonymous, Customer, DeliveryPerson, Moderator and MFA-pending staff are denied all four Discount operations; a Moderator can still read applied Product prices.
- E2E-16-02…04: Admin create/replay/conflict; list/detail agreement; greatest single saving without stacking; flat-versus-percentage and Product-versus-Category ties.
- E2E-16-05…07: whole-percent, money, target, body and date validation; bounded oversized-body errors; flat save-time guard; optimistic versions, unchanged stale retries and end replay; scheduled exclusion, rescheduling, inclusive end-today and ending before start.
- E2E-16-08: anonymous active-Product prices with only permitted public fields, ignored bearer headers, no-store and indistinguishable unknown/inactive/unpriced/malformed-ID 404 envelopes.
- E2E-16-14: Ticket 14 selling-price edits recompute current effective prices; Product audit stores selling-price changes; Discount edit/end touches no Product or unrelated table. An earlier HTTP value snapshot keeps its captured values.

Additional cases pin HALF_UP using explicit expected decimals, minimum price/saving eligibility, high-value money, price-drop replay, unpriced and inactive Product targets, current Category moves and deactivation, live counts on every tab, derived history actors/dates, payload bounds and stable paging. Validation also covers update/end shapes, versions, immutable targets, missing resources and list parameters. HTTP concurrency checks accept only valid serialized outcomes for duplicate creates, changed updates, update/end races and coherent price reads.

Calculator journeys explicitly include selling `150.00` with Product flat `20.00` against Category 10% (`130.00`), kind edits in both directions, and rejection of a stored-price edit above MRP without touching the Product or Discount. A three-candidate case selects the middle-created greatest saving, while much larger promotions on an unrelated Product and Category stay excluded from detail, list and public prices.

Security cases observe a genuine signed bearer expiring, revoke a synthetic session, demote a currently signed-in Admin, and scan the API log for distinctive target names, money, passwords and bearer credentials. Exact error keys and request correlation remain bounded.

Additional security cases exercise anonymous CORS OPTIONS for the collection POST, item PUT and end POST with the accepted frontend origin, Authorization/Content-Type request headers and allowed-method/header responses. Oversized bodies receive the bounded 400 only for a verified Admin; anonymous, Moderator and MFA-pending callers are rejected before body parsing on all three commands. A valid staff refresh cookie without bearer authorization still receives 401, while an enrolled Moderator's password-only `VERIFICATION_REQUIRED` bearer receives `MFA_REQUIRED` on every Discount route. Refused revoked/expired calls leave database fingerprints unchanged, and even a genuinely revoked bearer is ignored on the public price route.

Run through the plan's browser harness with `--grep "@t16"` or a particular acceptance ID. No tests are skipped or marked as expected failures: missing implementation is a real red result. Fixtures require the UTF8 test cluster, the current built jar, and the Dhaka-midnight guard.

The real Java `CurrentPrices` immutable snapshot, deterministic movable-calendar boundary crossings, migration from the pre-016 changeset, query counts and application restart remain backend integration requirements. HTTP snapshots, live-date assertions and concurrent HTTP launches do not claim those proofs. Add the accepted image-preservation journey to E2E-16-14 if Ticket 15 merges before Ticket 16.

Review additions pin numeric flat equivalence (`20`, `20.0`, `020.00`) on create and unchanged stale update retries, requiring no audit/table changes. Invalid mutation paths, omitted required PUT fields and malformed/non-object PUT bodies produce bounded errors without writes. Scheduled rows include equal starts with UUID order opposing insertion; Active and Ended rows test descending primary dates, ascending UUID ties and individual one-row pages. Guarded run-schema SQL establishes historical starts and exact Ended timestamps only for test-owned UUIDs. The log privacy case captures one bearer before the exercised Discount commands and sends those commands with that exact token before scanning the log.

Review coverage now bounds every promoted list AppliedDiscount to the exact six fields. A mixed-state Category fixture counts all four members (eligible active, priced inactive, unpriced, and below-flat-price), compares CategoryView and Discount counts, and checks moves in both directions change counts without Discount or audit writes. The Dhaka-midnight guard runs before each test fixture.

The complete rejected-create matrix fingerprints all application tables before and after invalid commands, excluding only renewable session tables; valid boundary controls run afterward. The security test waits for a genuinely signed access token to expire on the protected route, then compares the full public price response with its anonymous response. Invalid signatures are explicitly described as malformed tokens.

Server-facing update date cases separately reject a scheduled start before today and an active fixture end after its historical start but before today, requiring unchanged table fingerprints. The checked run-schema fixture backdates only its synthetic start without moving the production clock; an end equal to today remains valid and active. A changed PUT omitting optional `endsOn` clears an existing future end in the real stored row, increments the version once, updates list/detail prices, and replays the same omitted-end body at its original version without table or audit writes.

The started-start-date API guard is isolated from end-date ordering: otherwise valid changed starts in both directions submit `endsOn: null`. Every rejection preserves full table fingerprints, the exact original Active Discount view (including start, inclusive end, value and version), and the original detail/public price. The prior end-equal-today success remains the inclusive-end control.

The mixed flat/percentage tie journey compares the complete known public tuple after Category flat30.00 defeats Product10% on selling200.00: effective170.00, saving30.00 and exactly the Category/FLAT/30.00 descriptor.
