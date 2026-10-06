# `tests/identifiers.test.ts`

Source: [`tests/identifiers.test.ts`](../../tests/identifiers.test.ts)

Checks the client profile email format at the public `isProfileEmail` seam. Accepted cases include dot-atom punctuation and a 64-character local part. Refused cases include empty atoms, label-edge hyphens, a single-label domain, quoted and parenthesized forms, an IP literal, non-ASCII text and oversized parts. Backend validation remains authoritative.
