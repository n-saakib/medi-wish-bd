# tests/discounts.test.ts

Verifies strict discount and count projection, malformed dates/value/target fields, Dhaka midnight boundary, exact list/create/update/end requests, bounded errors, valid Bengali 50-item pages and oversized response rejection.

Review regressions authored 2026-10-14 reject single-element arrays for targetType, kind and status in direct/page projections and verify INVALID_RESPONSE on list/create/update/end replies. The shared value parser separately rejects targetType/kind arrays. These additions passed in the final npm run verify on 2026-10-15 (638 unit tests across 28 files).
