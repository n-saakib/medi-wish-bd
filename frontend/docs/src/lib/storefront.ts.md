# src/lib/storefront.ts

# `src/lib/storefront.ts`

Source: [`src/lib/storefront.ts`](../../../src/lib/storefront.ts)

## Purpose and behavior

Server-only anonymous catalog reads and public projections. The module keeps only category, card, price, image and Product-detail fields the storefront renders; it rejects malformed or unsafe metadata and caps each public JSON body at 256 KiB. Requests omit credentials and use the shared ten-second no-store API boundary. Category-page and Product responses must carry the same resource ID that was requested; a mismatched but otherwise valid response becomes an invalid-response error instead of rendering or canonicalizing the wrong resource. A 404 becomes not-found only when its bounded `NOT_FOUND` body carries the same valid request UUID as `X-Request-ID`; other failures remain errors. The API origin is read per call from `MEDI_WISH_SERVER_API_URL`, then `NEXT_PUBLIC_MEDI_WISH_API_URL`, then loopback.

## Verification

[`storefront.test.ts`](../../tests/storefront.test.ts.md) covers projections, request privacy/options, body/error limits, correlated 404s, response-ID binding and API-origin precedence. They pass in `npm run verify` (2026-10-20, working tree on `c63359c`, 1,024 unit tests).
