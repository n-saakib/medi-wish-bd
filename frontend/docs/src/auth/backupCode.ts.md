# `src/auth/backupCode.ts`

Source: [`src/auth/backupCode.ts`](../../../src/auth/backupCode.ts)

## Purpose and export

`backupCodeInput(value: string): string | null` normalizes a backup code for the recovery dialog. It rejects raw non-ASCII input before uppercasing, trims surrounding ASCII whitespace, removes literal interior spaces and at most one hyphen, then requires exactly eight characters from `ABCDEFGHJKMNPQRSTVWXYZ23456789`. Valid input returns `XXXX-XXXX`; invalid input returns `null` without echoing a credential.

Rejecting non-ASCII before uppercasing prevents Unicode expansions such as `ß` becoming valid ASCII letters. Interior tabs and newlines and multiple separators remain invalid.

## Verification

[`tests/backupCode.test.ts`](../../tests/backupCode.test.ts.md) covers accepted ASCII forms, lengths, excluded characters, separators, whitespace and Unicode expansions.
