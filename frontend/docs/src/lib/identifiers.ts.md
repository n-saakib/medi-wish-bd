# `src/lib/identifiers.ts`

Source: [`src/lib/identifiers.ts`](../../../src/lib/identifiers.ts)

## Purpose and behavior

`isProfileEmail(value)` checks the accepted ASCII dot-atom email subset for a new profile email: at most 254 characters overall, a 1–64 character local part, and at least two domain labels of at most 63 characters each. Local atoms cannot be empty; domain labels cannot begin or end with a hyphen. The form trims and lowercases before calling it. The API remains authoritative for validation and uniqueness.

`isUsername(value)` matches the API's username rule: 3–20 of `a–z`, `0–9`, `.`, `_` and `-`, with at least one letter. `isMobile(value)` accepts exactly 11 ASCII digits. Registration trims (and lower-cases the username) before calling them, as the API does.

## Verification

[`tests/identifiers.test.ts`](../../tests/identifiers.test.ts.md) covers allowed `atext` characters and refused dot, label, length and non-ASCII forms, plus accepted and refused usernames and mobile numbers.
