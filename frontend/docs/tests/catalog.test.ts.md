# `tests/catalog.test.ts`

Source: [`tests/catalog.test.ts`](../../tests/catalog.test.ts)

Focused unit coverage for the catalog client boundary: exact two-decimal money projection and grouping, malformed response rejection, required new selling price for price history and boolean before/after values for review history, legitimate Created/initial-price null fields and both review directions, bounded `INVALID_RESPONSE` errors with the existing safe copy mapping, the default 16 KiB versus catalog 256 KiB JSON bound, collection of active category pages, and the Admin-only pricing URL/body separation. The tests inject an authenticated fetch callback and require no server.

## Ticket 16

Ticket 16 fixtures include effectivePrice and appliedDiscount. Tests cover valid current-price metadata, null/malformed price rejection and typed derived discount history distinct from stored events.

Review regressions authored 2026-10-14 reject targetType/kind arrays in appliedDiscount and both DISCOUNT_STARTED/DISCOUNT_ENDED history boundaries, checking valid controls, pure Product projection rejection and client INVALID_RESPONSE. These additions passed in the final npm run verify on 2026-10-15 (638 unit tests across 28 files).
