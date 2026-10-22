# src/lib/storefrontView.ts

# `src/lib/storefrontView.ts`

Source: [`src/lib/storefrontView.ts`](../../../src/lib/storefrontView.ts)

## Purpose and behavior

Pure route and presentation helpers used by storefront server routes. It validates lower-case public UUIDs and one-based page queries, maps visible pages to the zero-based API page, derives price labels with exact minor-unit comparisons, normalizes plain-text metadata descriptions, and creates absolute canonical metadata from the configured site origin. `MEDI_WISH_SITE_URL` must be a bare HTTP(S) origin; the default is local loopback. Invalid origins fail clearly without exposing catalog data. The origin and canonical helpers take any string record as their environment, so tests can pass a plain object instead of Next's full `ProcessEnv`, which requires `NODE_ENV`.

## Verification

[`storefrontView.test.ts`](../../tests/storefrontView.test.ts.md) covers page parsing, ID shape, exact price comparisons, descriptions and canonical URLs. It passes in `npm run verify` (2026-10-20, working tree on `c63359c`).
