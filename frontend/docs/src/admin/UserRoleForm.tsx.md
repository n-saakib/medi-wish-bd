# `src/admin/UserRoleForm.tsx`

Source: [source](<../../../src/admin/UserRoleForm.tsx>).

## Purpose

The guarded UUID detail and single-role replacement component. Invalid UUIDs show not-found without an API call. Each radio is enabled only when included in `assignableRoles`; self, Super Admin and ordinary-Admin restrictions have visible reasons and the Admin radio has an accessible description.

Save is disabled until another permitted role is selected and rejects duplicate submits while busy. Success replaces detail/version/history and focuses its status. Failures clear busy while preserving intent and version for a safe retry; a stale conflict offers Reload and resets selection to the fresh record. Errors use bounded translated copy. History dates use the browser time zone and fixed D Mon YYYY, H:MM format; deleted actors read “a deleted account”. Profile/reset/session cards remain deferred. `tests/UserRoleForm.test.ts` covers permissions, interactions, recovery, guards and history.
