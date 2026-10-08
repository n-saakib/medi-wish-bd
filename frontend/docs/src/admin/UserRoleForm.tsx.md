# `src/admin/UserRoleForm.tsx`

Source: [source](<../../../src/admin/UserRoleForm.tsx>).

## Purpose

The guarded UUID detail and single-role replacement component. Invalid UUIDs show not-found without an API call. Each radio is enabled only when included in `assignableRoles`; self, Super Admin and ordinary-Admin restrictions have visible reasons and the Admin radio has an accessible description.

Save is disabled until another permitted role is selected and rejects duplicate submits while busy. Success replaces detail/version/history and focuses its status. Failures clear busy while preserving intent and version for a safe retry; a stale conflict offers Reload and resets selection to the fresh record. Errors reuse the shared errorMessageKey mapping, narrowed to staleUpdate, roleChangeRefused, accessDenied and notFound; all other failures keep generic bounded translated copy. History dates use the browser time zone and fixed D Mon YYYY, H:MM format; deleted actors read “a deleted account”. Profile/reset/session cards remain deferred. `tests/UserRoleForm.test.ts` covers permissions, interactions, recovery, guards and history.

Role-history times use the shared [`formatDateTime`](../lib/dateTime.ts.md) (2026-10-08): `27 Sep 2026, 9:02 am` in Asia/Dhaka, matching the product history and the page designs. They previously used the browser's own time zone and a 24-hour clock.
