# `src/admin/UserRolePage.tsx`

Source: [source](<../../../src/admin/UserRolePage.tsx>).

## Purpose

Reads `userId` through Next's client `useParams` and renders `UserRoleForm` with the UUID as its React key. Navigation creates a fresh form, so late detail/save responses from the prior route cannot overwrite the new User or carry an unsaved selection. The form validates UUIDs and guards the session. Navigation races are tested in `tests/UserRoleForm.test.ts`.
