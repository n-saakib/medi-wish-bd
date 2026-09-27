# `tests/totp.test.ts`

Source: [`../../tests/totp.test.ts`](../../tests/totp.test.ts)

## Purpose

Unit coverage for the test authenticator in [`tests/browser/totp.ts`](browser/totp.ts.md). It lives outside `tests/browser/` so Playwright does not collect it.

## Verification

- The RFC 6238 appendix B key `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` decodes to the ASCII seed `12345678901234567890`, with or without the page's four-character grouping.
- The six SHA1 vectors, reduced to 6 digits: 287082 at T=59, 081804 at T=1111111109, 050471 at T=1111111111, 005924 at T=1234567890, 279037 at T=2000000000 and 353130 at T=20000000000.
- A key with a character outside Base32 throws.

On 2026-09-27 it passed as part of `npm run test:unit`.
