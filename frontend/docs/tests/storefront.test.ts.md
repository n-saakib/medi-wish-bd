# tests/storefront.test.ts

Focused public-client and projection units. They cover accepted category/card/details shapes, privacy whitelisting, malformed IDs/prices/images, the 256 KiB body bound, request options, correlated 404 handling, mismatched requested/returned category and Product IDs, bounded server/network failures and runtime API-origin fallback. The server-only marker is mocked only for this isolated unit boundary. These tests were authored but not run while the baseline browser build owns `.next`.
