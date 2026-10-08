# `src/lib/identifiers.ts`

Source: [`src/lib/identifiers.ts`](../../../src/lib/identifiers.ts)

## Purpose and behavior

`isProfileEmail(value)` checks the accepted ASCII dot-atom email subset for a new profile email: at most 254 characters overall, a 1–64 character local part, and at least two domain labels of at most 63 characters each. Local atoms cannot be empty; domain labels cannot begin or end with a hyphen. The form trims and lowercases before calling it. The API remains authoritative for validation and uniqueness.

## Verification

[`tests/identifiers.test.ts`](../../tests/identifiers.test.ts.md) covers allowed `atext` characters and refused dot, label, length and non-ASCII forms.
