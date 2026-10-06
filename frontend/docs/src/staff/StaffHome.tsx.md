# `src/staff/StaffHome.tsx`

Source: [source](<../../../src/staff/StaffHome.tsx>).

## Purpose

The guarded staff landing component loads `/api/staff/me` only in VERIFIED sessions. It displays a translated one-role summary and Super Admin chip when appropriate. An Admin receives the Users and roles link; a Moderator does not. API authorization remains authoritative. Errors receive focus and bounded translated copy. Full dashboard/navigation remains Ticket 48. `tests/StaffHome.test.ts` verifies the summary, link, guards, failures and sign-out.
