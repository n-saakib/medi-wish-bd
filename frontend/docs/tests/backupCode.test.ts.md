# `tests/backupCode.test.ts`

Source: [`tests/backupCode.test.ts`](../../tests/backupCode.test.ts)

## Purpose

Behavior coverage for [`backupCodeInput`](../src/auth/backupCode.ts.md). The accepted table includes separated, unseparated, lowercase, spaced and surrounding-ASCII-whitespace input. The rejected table covers missing/incorrect lengths, D4 look-alike exclusions, repeated/incorrect separators, interior tabs/newlines, accented/full-width input and Unicode uppercase expansions (`ß`, `ﬀ`). Every accepted form produces `ABCD-2345`; malformed input returns `null`.
