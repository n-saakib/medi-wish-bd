# `tests/BackupCodesRegeneration.test.tsx`

Source: [`tests/BackupCodesRegeneration.test.tsx`](../../tests/BackupCodesRegeneration.test.tsx)

## Purpose and coverage

Mounted jsdom tests for the regeneration form use real session/translation providers. The request-mapping journey uses `createSessionClient` over `apiRoutes` and fake Web Locks: a spaced TOTP becomes `{ code: "123456" }`, ten codes show without setup steps, the guard holds and saving forgets them before `/staff`.

Focused cases protect local format validation, busy submission, invalid-code/lockout/generic errors and retry focus, redirects for every non-verified assurance status, pagehide clearing, ignoring an answer arriving after pagehide, and hiding codes after sign-out. All data is synthetic. Integrated Chrome/Edge behavior remains the authored Ticket 09 browser gates.
