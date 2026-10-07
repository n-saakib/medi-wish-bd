# `tests/UserRoleForm.test.ts`

Source: [source](<../../tests/UserRoleForm.test.ts>).

## Purpose

Component units through session/translation providers and the real HTTP client. They cover one permitted role, loaded versions, save/busy/duplicate-submit behavior, lock reasons, focused bounded failures, stale reload, network retry with the original command, nullable actors, malformed IDs, detail errors (including generic fallback for a shared MFA key outside this form) and session guards. Route-boundary cases navigate while a prior detail/save is pending and prove the next User remains displayed.
